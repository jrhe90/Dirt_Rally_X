import { BARRIER_HALF, EGO, LANES, laneCenter, laneOf, ROAD_EDGE } from '../config'
import type { Road } from '../road'
import type { Ego } from '../types'
import { egoAccelLimit, egoGrip } from '../vehicle'
import type { Predicted } from './prediction'
import type { Profile } from './profiles'

/**
 * Trajectory planner on a Frenet lattice (after Werling et al., "Optimal trajectory generation
 * for dynamic street scenarios in a Frenét frame"). Every replan samples a set of lateral
 * maneuvers — keep the lane, nudge within it, change one lane left or right, or (in Pursuit)
 * take the shoulder — as minimum-jerk quintics over a few durations, and a set of speed
 * profiles as quartics toward target speeds. Every lateral × longitudinal pair is checked
 * against the road limits, the tyres, and the predicted footprint of every tracked object, then
 * scored on comfort (jerk, acceleration), progress (deficit to the reference speed), following
 * distance, clearance, lane preference and consistency with the previous plan. The cheapest
 * collision-free pair wins; if there is none, the one that collides latest (usually the hardest
 * braking) is flown and the driver is told to take over.
 */

export const PLAN_DT = 0.2
export const PLAN_STEPS = 26
export const HORIZON = PLAN_DT * (PLAN_STEPS - 1)
const TIMES = Float64Array.from({ length: PLAN_STEPS }, (_, k) => k * PLAN_DT)
export const PLAN_TIMES = TIMES

type Lateral = {
  d: Float64Array
  dv: Float64Array
  da: Float64Array
  jerk: number
  T: number
  targetD: number
  lane: number
  nudge: boolean
}

type Longitudinal = {
  s: Float64Array
  v: Float64Array
  a: Float64Array
  jerk: number
  T: number
  vT: number
  minV: number
}

export type Trajectory = {
  t0: number
  s: Float64Array
  d: Float64Array
  vs: Float64Array
  vd: Float64Array
  as: Float64Array
  ad: Float64Array
  targetLane: number
  targetD: number
  vTarget: number
  cost: number
  /** First predicted contact, s from now (Infinity if none). */
  collision: number
  laneChange: boolean
  /** Lane we were in (or committed to) when the plan was made. */
  refLane: number
}

export type PlanInput = {
  t: number
  ego: Ego
  road: Road
  obstacles: Predicted[]
  profile: Profile
  setSpeed: number
  /** Driver-requested lane change: +1 left, -1 right, 0 none. */
  request: number
}

export type PlanResult = {
  best: Trajectory
  alternatives: Trajectory[]
  feasible: boolean
  /** Reference speed now, after curve limits. */
  vRef: number
  vCurve: number
  evaluated: number
}

function quintic(d0: number, v0: number, a0: number, dT: number, T: number): Lateral['d'][] {
  const delta = dT - d0
  const T2 = T * T
  const T3 = T2 * T
  const c3 = (20 * delta - 12 * v0 * T - 3 * a0 * T2) / (2 * T3)
  const c4 = (-30 * delta + 16 * v0 * T + 3 * a0 * T2) / (2 * T3 * T)
  const c5 = (12 * delta - 6 * v0 * T - a0 * T2) / (2 * T3 * T2)
  const d = new Float64Array(PLAN_STEPS)
  const dv = new Float64Array(PLAN_STEPS)
  const da = new Float64Array(PLAN_STEPS)
  const j = new Float64Array(PLAN_STEPS)
  for (let k = 0; k < PLAN_STEPS; k++) {
    const t = Math.min(TIMES[k], T)
    const t2 = t * t
    const t3 = t2 * t
    d[k] = d0 + v0 * t + 0.5 * a0 * t2 + c3 * t3 + c4 * t3 * t + c5 * t3 * t2
    dv[k] = TIMES[k] > T ? 0 : v0 + a0 * t + 3 * c3 * t2 + 4 * c4 * t3 + 5 * c5 * t3 * t
    da[k] = TIMES[k] > T ? 0 : a0 + 6 * c3 * t + 12 * c4 * t2 + 20 * c5 * t3
    j[k] = TIMES[k] > T ? 0 : 6 * c3 + 24 * c4 * t + 60 * c5 * t2
  }
  return [d, dv, da, j]
}

function quartic(s0: number, v0: number, a0: number, vT: number, T: number): Longitudinal {
  const B = vT - v0 - a0 * T
  const c4 = -(B + (a0 * T) / 2) / (2 * T ** 3)
  const c3 = (-a0 - 12 * c4 * T * T) / (6 * T)
  const s = new Float64Array(PLAN_STEPS)
  const v = new Float64Array(PLAN_STEPS)
  const a = new Float64Array(PLAN_STEPS)
  let jerk = 0
  let minV = Infinity
  const sT = s0 + v0 * T + 0.5 * a0 * T * T + c3 * T ** 3 + c4 * T ** 4
  for (let k = 0; k < PLAN_STEPS; k++) {
    const t = TIMES[k]
    if (t <= T) {
      s[k] = s0 + v0 * t + 0.5 * a0 * t * t + c3 * t ** 3 + c4 * t ** 4
      v[k] = v0 + a0 * t + 3 * c3 * t * t + 4 * c4 * t ** 3
      a[k] = a0 + 6 * c3 * t + 12 * c4 * t * t
      const jk = 6 * c3 + 24 * c4 * t
      jerk += jk * jk * PLAN_DT
    } else {
      s[k] = sT + vT * (t - T)
      v[k] = vT
      a[k] = 0
    }
    minV = Math.min(minV, v[k])
  }
  // Stopping profiles: once stopped, stay stopped.
  if (vT <= 0.01) {
    for (let k = 1; k < PLAN_STEPS; k++) {
      if (v[k] < 0 || s[k] < s[k - 1]) {
        v[k] = 0
        a[k] = 0
        s[k] = s[k - 1]
      }
    }
    minV = Math.max(minV, -0.2)
  }
  return { s, v, a, jerk, T, vT, minV }
}

/** Curve-limited speed along the road ahead, with room to brake for each curve. */
class SpeedTable {
  private readonly step = 5
  private readonly values: Float64Array
  private readonly s0: number
  constructor(s0: number, road: Road, latAccel: number, decel: number, cap: number) {
    this.s0 = s0
    const n = 100
    this.values = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const k = Math.abs(road.kappa(s0 + i * this.step))
      this.values[i] = Math.min(cap, k > 1e-5 ? Math.sqrt(latAccel / k) : cap)
    }
    for (let i = n - 2; i >= 0; i--) this.values[i] = Math.min(this.values[i], Math.sqrt(this.values[i + 1] ** 2 + 2 * decel * this.step))
  }
  at(s: number): number {
    const i = Math.max(0, Math.min(this.values.length - 1, Math.floor((s - this.s0) / this.step)))
    return this.values[i]
  }
}

export class Planner {
  targetLane = 1
  fromLane = 1
  changing = false
  cooldown = 0
  previous: Trajectory | null = null
  /** A lane change we'd like to make: indicate first, commit if it stays the better choice. */
  pendingLane: number | null = null
  pendingTime = 0
  private lastT = 0

  reset(lane: number): void {
    this.targetLane = lane
    this.fromLane = lane
    this.changing = false
    this.cooldown = 0
    this.previous = null
    this.pendingLane = null
    this.pendingTime = 0
  }

  /** Lateral state at the start of the plan: continue from the previous plan when we're on it. */
  private startState(input: PlanInput): [number, number, number, number, number, number] {
    const e = input.ego
    const vs = e.v * Math.cos(e.psi)
    const vd = e.v * Math.sin(e.psi)
    let ad = 0
    let as = e.accel
    const p = this.previous
    if (p) {
      const tau = input.t - p.t0
      const k = Math.min(PLAN_STEPS - 2, Math.floor(tau / PLAN_DT))
      const f = Math.max(0, Math.min(1, tau / PLAN_DT - k))
      const pd = p.d[k] + (p.d[k + 1] - p.d[k]) * f
      if (Math.abs(pd - e.d) < 0.5) {
        ad = p.ad[k] + (p.ad[k + 1] - p.ad[k]) * f
        as = p.as[k] + (p.as[k + 1] - p.as[k]) * f
      }
    }
    return [e.s, vs, as, e.d, vd, ad]
  }

  plan(input: PlanInput): PlanResult {
    const { ego, profile, road } = input
    const dtSince = this.lastT ? Math.max(0, input.t - this.lastT) : 0
    this.lastT = input.t
    this.cooldown = Math.max(0, this.cooldown - dtSince)

    // Lane bookkeeping: has the lane change finished?
    const egoLane = laneOf(ego.d)
    if (this.changing && Math.abs(ego.d - laneCenter(this.targetLane)) < 0.45) {
      this.changing = false
      this.fromLane = this.targetLane
      this.cooldown = profile.cooldown
    }
    if (!this.changing) {
      this.targetLane = egoLane
      this.fromLane = egoLane
    }
    const refLane = this.targetLane

    const [s0, vs0, as0, d0, vd0, ad0] = this.startState(input)
    const top = Math.min(input.setSpeed, EGO.topSpeed, ego.tiresBlown ? 16 : Infinity)
    const table = new SpeedTable(s0, road, profile.latAccel, profile.decel, top)
    const vCurve = table.at(s0)
    const vRef = Math.min(top, vCurve)
    const grip = egoGrip(ego) * 0.92

    // Lateral candidates.
    // Mid-change the only choices are to carry on or go back.
    const lanes = new Set<number>([refLane, this.fromLane])
    if (!this.changing) {
      // Every lane is a candidate; sweeping across more than one is for emergencies.
      for (let lane = 0; lane < LANES; lane++) lanes.add(lane)
      if (profile.shoulder || refLane === LANES) lanes.add(LANES)
    }
    const speedFactor = Math.max(0.55, Math.min(1.1, vs0 / 30))
    const laterals: Lateral[] = []
    const addLat = (targetD: number, T: number, lane: number, nudge: boolean) => {
      const [d, dv, da, j] = quintic(d0, vd0, ad0, targetD, T)
      let jerk = 0
      for (let k = 0; k < PLAN_STEPS; k++) jerk += j[k] * j[k] * PLAN_DT
      laterals.push({ d, dv, da, jerk, T, targetD, lane, nudge })
    }
    for (const lane of lanes) {
      const c = laneCenter(lane)
      if (lane === refLane) {
        addLat(c, 1.4, lane, false)
        addLat(c, 2.6, lane, false)
        for (const off of [-0.8, -0.4, 0.4, 0.8]) addLat(c + off, 1.8, lane, true)
      } else {
        const base = profile.laneChangeTime * speedFactor * (1 + 0.35 * (Math.abs(lane - refLane) - 1))
        if (this.changing && lane === this.fromLane) {
          // Quick ways back out of a lane change that has turned unsafe.
          for (const T of [1.0, 1.5, 2.2]) addLat(c, T, lane, false)
          continue
        }
        const factors = Math.abs(lane - refLane) > 1 ? [0.85, 1.15] : [0.62, 1, 1.35]
        for (const f of factors) addLat(c, Math.max(1.3, base * f), lane, false)
      }
    }

    // Longitudinal candidates.
    const speeds: number[] = [vRef, vRef * 0.92, vs0, vs0 + 2, vs0 - 2, vs0 - 6, vs0 * 0.6, vs0 * 0.3, 0]
    for (const o of input.obstacles) {
      if (o.s[0] > s0 && o.s[0] - s0 < 140 && !o.follower) speeds.push(o.vs, o.vs - 1.5)
    }
    const uniq: number[] = []
    for (const v of speeds) {
      const c = Math.max(0, Math.min(top, v))
      if (!uniq.some((u) => Math.abs(u - c) < 0.6)) uniq.push(c)
    }
    const longs: Longitudinal[] = []
    for (const T of [1.8, 3.8]) {
      for (const vT of uniq) longs.push(quartic(s0, vs0, as0, vT, T))
      // The most this duration can gain, and two-thirds of it.
      const reach = 0.62 * Math.min(profile.accel, egoAccelLimit(vs0, ego.tiresBlown)) * T
      for (const f of [0.66, 1]) {
        const vT = Math.min(top, vs0 + reach * f)
        if (vT > vs0 + 2.5) longs.push(quartic(s0, vs0, as0, vT, T))
      }
    }
    // Emergency stop, as hard as the brakes allow.
    longs.push(quartic(s0, vs0, as0, 0, Math.max(0.6, (1.5 * vs0) / (EGO.maxBrake * 0.92))))

    // Beyond the horizon: how fast will each lane let us go? A slow car 150 m up the lane
    // matters if we'd catch it within ~20 s.
    const flow = new Map<number, number>()
    for (const lane of lanes) {
      const c = laneCenter(Math.min(lane, LANES))
      let worst = 0
      for (const o of input.obstacles) {
        if (o.follower || Math.abs(o.d[0] - c) > o.hd + EGO.width / 2) continue
        const gap = o.s[0] - s0 - o.hs - EGO.length / 2
        if (gap < 0 || gap > 300) continue
        const closing = vRef - Math.max(0, o.vs)
        if (closing <= 0) continue
        const ttr = gap / Math.max(1, vs0 - o.vs + 0.5)
        const weight = Math.max(0, Math.min(1, 1 - ttr / 22))
        worst = Math.max(worst, closing * weight)
      }
      flow.set(lane, worst)
    }

    // Static costs per lateral.
    const latStatic = laterals.map((L) => {
      let c = profile.smooth * 0.011 * L.jerk
      c += 0.45 * (flow.get(L.lane) ?? 0)
      const laneCost = [0.6, 0, 0.15, 9][L.lane] * (L.lane === LANES ? 1 : profile.keepRight)
      c += laneCost
      if (L.nudge) c += 0.5 + Math.abs(L.targetD - laneCenter(L.lane))
      if (L.lane !== refLane) {
        // Passing costs a real speed advantage; moving back right is cheap.
        c += L.lane > refLane && L.lane < LANES ? 0.35 : profile.passGain * 0.9
        if (Math.abs(L.lane - refLane) > 1) c += 7 * (Math.abs(L.lane - refLane) - 1)
        if (this.cooldown > 0) c += profile.passGain * 2 + 1.5
        if (this.changing && L.lane === this.fromLane) c += 2.5 + profile.passGain
      }
      if (input.request !== 0 && L.lane === refLane - input.request) c -= profile.passGain * 0.9 + 4
      return c
    })
    const longStatic = longs.map((G) => {
      let c = profile.smooth * 0.004 * G.jerk
      for (let k = 0; k < PLAN_STEPS; k++) {
        const a = G.a[k]
        if (a > profile.accel) c += (a - profile.accel) ** 2 * PLAN_DT * 0.6
        if (a < -profile.decel) c += (-profile.decel - a) ** 2 * PLAN_DT * 0.25
        const ref = Math.min(top, table.at(G.s[k]))
        c += (Math.max(0, ref - G.v[k]) * PLAN_DT) / HORIZON
        const over = G.v[k] - table.at(G.s[k]) * 1.02
        if (over > 0) c += over * over * PLAN_DT * 0.8
      }
      return c
    })

    const minD = -ROAD_EDGE + EGO.width / 2 + 0.25
    const maxD = -BARRIER_HALF - EGO.width / 2 - 0.25
    const halfL = EGO.length / 2
    const halfW = EGO.width / 2
    const obstacles = input.obstacles

    type Pick = { L: number; G: number; cost: number; collision: number; rank: number }
    let best: Pick | null = null
    const bestByLane = new Map<number, Pick>()
    let fallback: Pick | null = null
    const scored: { L: number; G: number; cost: number }[] = []
    let evaluated = 0

    for (let li = 0; li < laterals.length; li++) {
      const L = laterals[li]
      for (let gi = 0; gi < longs.length; gi++) {
        const G = longs[gi]
        let cost = latStatic[li] + longStatic[gi]
        const laneBest = bestByLane.get(L.lane)
        if (laneBest && cost >= laneBest.cost) continue
        evaluated++
        // Soft: inside the safety margins. Hard: actual contact.
        let soft = false
        let hard = Infinity
        // How far past the road edges, the tyres and the motor this pair goes.
        let violation = 0
        for (let k = 1; k < PLAN_STEPS; k++) {
          const v = Math.max(0, G.v[k])
          const d = L.d[k]
          if (d < minD) violation += minD - d
          else if (d > maxD) violation += d - maxD
          const latA = v * v * road.kappa(G.s[k]) + L.da[k]
          if (Math.abs(latA) > grip) violation += (Math.abs(latA) - grip) * 0.3
          const accLimit = egoAccelLimit(v, ego.tiresBlown) + 0.4
          if (G.a[k] > accLimit) violation += (G.a[k] - accLimit) * 0.3
          const vdLimit = 0.5 * v + 0.4
          if (Math.abs(L.dv[k]) > vdLimit) violation += Math.abs(L.dv[k]) - vdLimit
          if (violation > 0 && laneBest) break
          if (Math.abs(latA) > profile.latAccel) cost += (Math.abs(latA) - profile.latAccel) ** 2 * PLAN_DT * 0.5
          const psi = Math.atan2(L.dv[k], Math.max(1, v))
          const cp = Math.cos(psi)
          const sp = Math.abs(Math.sin(psi))
          const ehs = halfL * cp + halfW * sp
          const ehd = halfL * sp + halfW * cp
          const s = G.s[k]
          const t = TIMES[k]
          const mS = profile.marginS
          const mD = profile.marginD + 0.035 * t
          for (const o of obstacles) {
            const ds = o.s[k] - s
            const lonReach = ehs + o.hs
            if (ds > lonReach + 120 || ds < -lonReach - 60) continue
            const dd = Math.abs(o.d[k] - d)
            const latReach = ehd + o.hd
            if (o.follower) continue
            const pad = o.threat * 0.5
            // Swept: at speed the car covers more than an obstacle's length between samples,
            // so also catch passing through it (ds changes sign) while overlapping laterally.
            const dsPrev = o.s[k - 1] - G.s[k - 1]
            const crossed = dsPrev > 0 !== ds > 0 && Math.min(dd, Math.abs(o.d[k - 1] - L.d[k - 1])) < latReach
            if (((Math.abs(ds) < lonReach + 0.05 && dd < latReach + 0.05) || crossed) && t < hard) hard = t
            if ((Math.abs(ds) < lonReach + mS * o.margin && dd < latReach + mD * o.margin + pad) || crossed) soft = true
            if (dd < latReach + 0.2) {
              if (ds > 0) {
                // Following distance to whatever is ahead in our corridor.
                const gap = ds - lonReach
                const want = profile.minGap + profile.headway * v
                if (gap < want) cost += ((want - gap) / want) ** 2 * PLAN_DT * 6
              } else if (o.vs > 2) {
                // Don't cut in front of someone: they need time to react, more if they're faster.
                const gap = -ds - lonReach
                const need = 2 + o.vs * 0.32 * (profile.headway / 1.5 + 0.35) + Math.max(0, o.vs - v) * 1.1
                if (gap < need) {
                  cost += ((need - gap) / need) ** 2 * PLAN_DT * 8
                  if (gap < need * 0.45) soft = true
                }
              }
            } else if (Math.abs(ds) < lonReach + 2) {
              // Side clearance while overlapping.
              const gap = dd - latReach
              if (gap < 1.1) cost += (1.1 - gap) ** 2 * PLAN_DT * (0.8 + profile.copAvoid * o.threat)
            }
            // Keep away from interceptors in general.
            if (o.kind === 'police' && profile.copAvoid > 0) {
              const dist = Math.hypot(ds, dd)
              if (dist < 25) cost += (profile.copAvoid * 0.08 * PLAN_DT * (25 - dist)) / 25
            }
          }
          if (hard !== Infinity) break
        }
        if (violation > 0 || soft || hard !== Infinity) {
          // Fallback ranking: latest contact first, then least physically impossible, then cheapest.
          const rank = (hard === Infinity ? 0 : (HORIZON + 1 - hard) * 1e4) + violation * 100 + (soft ? 50 : 0) + Math.min(cost, 40)
          if (!fallback || rank < fallback.rank) fallback = { L: li, G: gi, cost, collision: hard, rank }
          continue
        }
        scored.push({ L: li, G: gi, cost })
        const pick = { L: li, G: gi, cost, collision: Infinity, rank: 0 }
        if (!laneBest || cost < laneBest.cost) bestByLane.set(L.lane, pick)
        if (!best || cost < best.cost) best = pick
      }
    }

    const feasible = best !== null
    let chosen = best ?? fallback!
    const keep = bestByLane.get(refLane) ?? null
    const prep = Math.max(0, profile.laneChangePrep)
    if (this.changing) {
      // Committed: carry on unless that has become unsafe or far worse than backing out.
      if (keep && (!best || keep.cost <= best.cost + 3)) chosen = keep
      this.pendingLane = null
    } else if (best && laterals[best.L].lane !== refLane) {
      const lane = laterals[best.L].lane
      const urgent = !keep || keep.cost - best.cost > 6
      const clearlyBetter = !keep || keep.cost - best.cost > 0.25
      if (!clearlyBetter) {
        this.pendingLane = null
        this.pendingTime = 0
        chosen = keep!
      } else if (urgent || (this.pendingLane === lane && this.pendingTime >= prep)) {
        this.pendingLane = null
        this.pendingTime = 0
      } else {
        // Indicate and hold the lane for now.
        this.pendingTime = this.pendingLane === lane ? this.pendingTime + dtSince : 0
        this.pendingLane = lane
        chosen = keep!
      }
    } else {
      this.pendingLane = null
      this.pendingTime = 0
    }
    const build = (li: number, gi: number, cost: number, collision: number): Trajectory => {
      const L = laterals[li]
      const G = longs[gi]
      return {
        t0: input.t,
        s: G.s,
        d: L.d,
        vs: G.v,
        vd: L.dv,
        as: G.a,
        ad: L.da,
        targetLane: L.lane,
        targetD: L.targetD,
        vTarget: G.vT,
        cost,
        collision,
        laneChange: L.lane !== refLane,
        refLane,
      }
    }
    const traj = build(chosen.L, chosen.G, chosen.cost, chosen.collision)

    if (!this.changing && traj.laneChange) {
      this.fromLane = refLane
      this.targetLane = traj.targetLane
      this.changing = true
    } else if (this.changing && traj.targetLane !== this.targetLane) {
      // Aborted back to where we came from.
      const back = traj.targetLane
      this.targetLane = back
      this.fromLane = back
      this.changing = Math.abs(ego.d - laneCenter(back)) > 0.45
    }
    this.previous = traj

    // A few runners-up in other lanes, for the visualization.
    const alternatives: Trajectory[] = []
    scored.sort((a, b) => a.cost - b.cost)
    const seen = new Set<number>([laterals[chosen.L].lane])
    for (const c of scored) {
      const lane = laterals[c.L].lane
      if (seen.has(lane)) continue
      seen.add(lane)
      alternatives.push(build(c.L, c.G, c.cost, Infinity))
    }
    return { best: traj, alternatives, feasible, vRef, vCurve, evaluated }
  }
}

export function sampleTrajectory(tr: Trajectory, tau: number, key: 's' | 'd' | 'vs' | 'vd' | 'as' | 'ad'): number {
  const arr = tr[key]
  const f = Math.max(0, tau) / PLAN_DT
  const k = Math.min(PLAN_STEPS - 2, Math.floor(f))
  const t = Math.min(1, f - k)
  return arr[k] + (arr[k + 1] - arr[k]) * t
}

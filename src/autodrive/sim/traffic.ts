import { nextRandom, randomRange } from '../../flyer/sim/rng'
import { LANES, laneCenter, oncomingLaneCenter, TRAFFIC } from './config'
import { halfLengthS, halfWidthD } from './collide'
import type { Agent, Body, BodyKind, Role, SimState } from './types'

/**
 * Civilian traffic: the Intelligent Driver Model for following, MOBIL-style lane changes with a
 * keep-right bias, and a few aggressive drivers who cut in on small gaps. Oncoming traffic
 * beyond the median just holds its lane and speed.
 */

type Spec = { length: number; width: number; height: number; weight: number; speed: [number, number] }

export const SPECS: Record<BodyKind, Spec> = {
  sedan: { length: 4.75, width: 1.85, height: 1.45, weight: 5, speed: [26, 34] },
  hatch: { length: 4.2, width: 1.8, height: 1.5, weight: 3, speed: [24, 32] },
  suv: { length: 4.9, width: 1.98, height: 1.75, weight: 4, speed: [25, 33] },
  van: { length: 5.3, width: 2.02, height: 2.05, weight: 2, speed: [23, 29] },
  truck: { length: 9.2, width: 2.5, height: 3.5, weight: 2, speed: [21, 25] },
  sports: { length: 4.5, width: 1.95, height: 1.24, weight: 1, speed: [31, 38] },
  cop: { length: 4.95, width: 1.92, height: 1.5, weight: 0, speed: [30, 30] },
  ego: { length: 4.97, width: 1.96, height: 1.44, weight: 0, speed: [30, 30] },
}

const CIVILIAN: BodyKind[] = ['sedan', 'hatch', 'suv', 'van', 'truck', 'sports']
const TOTAL_WEIGHT = CIVILIAN.reduce((t, k) => t + SPECS[k].weight, 0)
export const PAINT_COUNT = 12

function pickKind(s: { rng: number }): BodyKind {
  let r = nextRandom(s) * TOTAL_WEIGHT
  for (const k of CIVILIAN) {
    r -= SPECS[k].weight
    if (r <= 0) return k
  }
  return 'sedan'
}

export function createAgent(sim: SimState, role: Role, kind: BodyKind, s: number, lane: number, v: number): Agent {
  const spec = SPECS[kind]
  const dir = role === 'oncoming' ? -1 : 1
  return {
    id: sim.nextId++,
    role,
    kind,
    s,
    d: dir > 0 ? laneCenter(lane) : oncomingLaneCenter(lane),
    v,
    psi: 0,
    length: spec.length,
    width: spec.width,
    height: spec.height,
    dir,
    vd: 0,
    accel: 0,
    lane,
    targetLane: lane,
    desiredV: v,
    signal: 0,
    laneTimer: randomRange(sim, 1, 4),
    aggressive: false,
    wrecked: -1,
    spin: 0,
    color: Math.floor(nextRandom(sim) * PAINT_COUNT),
    copState: 'chase',
    health: 1,
    copTargetD: 0,
    stateTimer: 0,
  }
}

const IDM = { a: 1.5, b: 2.2, s0: 2.5 }

/** Intelligent Driver Model acceleration. `gap` is bumper to bumper, `dv` is our speed minus the leader's. */
export function idm(v: number, v0: number, gap: number, dv: number, headway: number, a = IDM.a, b = IDM.b): number {
  const free = 1 - (Math.max(0, v) / Math.max(1, v0)) ** 4
  if (!Number.isFinite(gap)) return a * free
  const sStar = IDM.s0 + Math.max(0, v * headway + (v * dv) / (2 * Math.sqrt(a * b)))
  return Math.max(-9, a * (free - (sStar / Math.max(0.2, gap)) ** 2))
}

export type Neighbor = { body: Body | null; gap: number }

/** Nearest body ahead (dir 1) or behind (dir -1) of `self` whose lateral extent overlaps [d0, d1]. */
export function neighbor(self: Body, bodies: readonly Body[], d0: number, d1: number, dir: 1 | -1): Neighbor {
  let best: Body | null = null
  let gap = Infinity
  const selfHalf = self.length / 2
  for (const b of bodies) {
    if (b === self || b.id === self.id) continue
    const hw = halfWidthD(b)
    if (b.d + hw < d0 || b.d - hw > d1) continue
    const ds = (b.s - self.s) * dir
    if (ds <= 0) continue
    const g = ds - selfHalf - halfLengthS(b)
    if (g < gap) {
      gap = g
      best = b
    }
  }
  return { body: best, gap }
}

/** Every body that takes part in same-direction traffic (the hero car, civilians, police, wrecks). */
export function flowBodies(sim: SimState): Body[] {
  const list: Body[] = [sim.ego]
  for (const a of sim.agents) if (a.role !== 'oncoming') list.push(a)
  return list
}

function laneSpan(lane: number, hw: number): [number, number] {
  const c = laneCenter(lane)
  return [c - hw, c + hw]
}

/** Acceleration this agent would get following the leader in `lane`. */
function accelInLane(a: Agent, lane: number, bodies: readonly Body[], headway: number): number {
  const hw = a.width / 2
  const [d0, d1] = laneSpan(lane, hw)
  const lead = neighbor(a, bodies, d0, d1, 1)
  return idm(a.v, a.desiredV, lead.gap, lead.body ? a.v - lead.body.v : 0, headway)
}

function considerLaneChange(sim: SimState, a: Agent, bodies: readonly Body[]): void {
  if (a.targetLane !== a.lane) return
  const headway = a.aggressive ? 0.8 : 1.4
  const here = accelInLane(a, a.lane, bodies, headway)
  let bestGain = a.aggressive ? 0.12 : 0.35
  let choice = a.lane
  for (const dir of [-1, 1]) {
    const lane = a.lane + dir
    if (lane < 0 || lane >= LANES) continue
    if (a.kind === 'truck' && lane === 0) continue
    const hw = a.width / 2
    const [d0, d1] = laneSpan(lane, hw)
    // Gap must exist right beside us.
    const lead = neighbor(a, bodies, d0, d1, 1)
    const follow = neighbor(a, bodies, d0, d1, -1)
    if (lead.gap < (a.aggressive ? 2 : 6) || follow.gap < (a.aggressive ? 1.5 : 7)) continue
    // The new follower must not have to brake hard.
    if (follow.body) {
      const fb = follow.body
      const fa = idm(fb.v, Math.max(fb.v, 25), follow.gap, fb.v - a.v, 1.2)
      if (fa < (a.aggressive ? -6.5 : -2.5)) continue
    }
    const there = idm(a.v, a.desiredV, lead.gap, lead.body ? a.v - lead.body.v : 0, headway)
    // Keep right unless passing.
    const bias = dir > 0 ? 0.22 : -0.12
    const gain = there - here + bias
    if (gain > bestGain) {
      bestGain = gain
      choice = lane
    }
  }
  if (choice !== a.lane) {
    a.targetLane = choice
    a.signal = choice < a.lane ? 1 : -1
  }
  a.laneTimer = a.aggressive ? randomRange(sim, 0.6, 1.8) : randomRange(sim, 1.5, 4.5)
}

/** Wrecked cars slide to a stop, spinning. */
export function stepWreck(a: Agent, dt: number): void {
  a.wrecked += dt
  const sign = Math.sign(a.v)
  a.v -= sign * Math.min(Math.abs(a.v), 7 * dt)
  a.spin *= Math.exp(-1.6 * dt)
  a.psi += a.spin * dt
  a.s += a.v * Math.cos(a.psi) * dt * a.dir
  a.d += (a.vd + a.v * Math.sin(a.psi) * 0.3) * dt
  a.vd *= Math.exp(-2.5 * dt)
  a.signal = 0
}

export function stepCivilian(sim: SimState, a: Agent, bodies: readonly Body[], dt: number): void {
  if (a.wrecked >= 0) {
    stepWreck(a, dt)
    return
  }
  if (a.role === 'oncoming') {
    a.s -= a.v * dt
    return
  }
  a.laneTimer -= dt
  if (a.laneTimer <= 0) considerLaneChange(sim, a, bodies)

  // Follow whatever is ahead in our lane and, mid-change, the target lane too.
  const hw = a.width / 2
  const c0 = laneCenter(a.lane)
  const c1 = laneCenter(a.targetLane)
  const lead = neighbor(a, bodies, Math.min(c0, c1, a.d) - hw, Math.max(c0, c1, a.d) + hw, 1)
  const headway = a.aggressive ? 0.9 : a.kind === 'truck' ? 1.8 : 1.45
  const acc = a.kind === 'truck' ? 0.9 : 1.5
  a.accel = idm(a.v, a.desiredV, lead.gap, lead.body ? a.v - lead.body.v : 0, headway, acc)
  a.v = Math.max(0, a.v + a.accel * dt)
  a.s += a.v * dt

  // Lateral: ease toward the target lane center.
  const target = laneCenter(a.targetLane)
  const latSpeed = a.aggressive ? 2.2 : 1.1
  const want = Math.max(-latSpeed, Math.min(latSpeed, (target - a.d) * 1.1))
  a.vd += Math.max(-2 * dt, Math.min(2 * dt, want - a.vd))
  a.d += a.vd * dt
  a.psi = Math.atan2(a.vd, Math.max(3, a.v))
  if (Math.abs(target - a.d) < 0.15 && a.targetLane !== a.lane) {
    a.lane = a.targetLane
    a.signal = 0
  }
}

function clearAt(sim: SimState, s: number, d: number, role: Role, room: number): boolean {
  if (role !== 'oncoming' && Math.abs(sim.ego.s - s) < room + 10 && Math.abs(sim.ego.d - d) < 3) return false
  for (const b of sim.agents) {
    if ((b.role === 'oncoming') !== (role === 'oncoming')) continue
    if (Math.abs(b.d - d) < 3 && Math.abs(b.s - s) < room) return false
  }
  return true
}

function spawnCivilian(sim: SimState, s: number, lane: number, role: Role): boolean {
  let kind = pickKind(sim)
  if (role === 'traffic' && kind === 'truck' && lane === 0) kind = 'sedan'
  const spec = SPECS[kind]
  const laneBoost = role === 'traffic' ? (1 - lane) * 2.2 : 0
  const v = randomRange(sim, spec.speed[0], spec.speed[1]) + laneBoost
  const d = role === 'oncoming' ? oncomingLaneCenter(lane) : laneCenter(lane)
  if (!clearAt(sim, s, d, role, 30 + v * 0.6)) return false
  // Police have closed the road ahead of a roadblock.
  if (role === 'traffic' && sim.roadblocks.some((r) => !r.passed && s > r.s - 480 && s < r.s + 40)) return false
  const a = createAgent(sim, role, kind, s, lane, v)
  a.aggressive = role === 'traffic' && nextRandom(sim) < 0.08
  if (a.aggressive) a.desiredV += 4
  sim.agents.push(a)
  return true
}

/** Density ramps up with distance driven. */
function density(sim: SimState): number {
  const f = Math.min(1, sim.ego.odometer / 9000)
  return TRAFFIC.densityMin + (TRAFFIC.densityMax - TRAFFIC.densityMin) * f
}

export function populateTraffic(sim: SimState): void {
  const e = sim.ego
  const per = density(sim) / 1000
  for (let lane = 0; lane < LANES; lane++) {
    for (let s = e.s - TRAFFIC.behind; s < e.s + TRAFFIC.ahead; s += randomRange(sim, 0.5, 1.5) / per) {
      if (Math.abs(s - e.s) < 40) continue
      spawnCivilian(sim, s, lane, 'traffic')
    }
    for (let s = e.s - TRAFFIC.behind; s < e.s + TRAFFIC.ahead + 200; s += randomRange(sim, 0.5, 1.5) / (TRAFFIC.oncomingDensity / 1000)) {
      spawnCivilian(sim, s, lane, 'oncoming')
    }
  }
}

/** Spawn at the edges of the window around the hero car and drop what falls out of it. */
export function maintainTraffic(sim: SimState): void {
  const e = sim.ego
  sim.agents = sim.agents.filter((a) => {
    const ds = a.s - e.s
    if (a.role === 'cop' && a.copState !== 'parked') return ds > -900 && ds < 1200
    return ds < TRAFFIC.despawnAhead + 250 && ds > -TRAFFIC.despawnBehind
  })
  const counts = [0, 0, 0]
  let oncoming = 0
  for (const a of sim.agents) {
    if (a.role === 'traffic') counts[Math.min(LANES - 1, a.lane)]++
    else if (a.role === 'oncoming') oncoming++
  }
  const window = (TRAFFIC.ahead + TRAFFIC.behind) / 1000
  const target = density(sim) * window
  for (let lane = 0; lane < LANES; lane++) {
    if (counts[lane] >= target) continue
    // Spawn ahead when we're catching traffic, behind when it's catching us.
    const laneSpeed = 28 + (1 - lane) * 2
    const behind = e.v < laneSpeed - 3 && nextRandom(sim) < 0.6
    const s = behind ? e.s - TRAFFIC.behind - randomRange(sim, 0, 40) : e.s + TRAFFIC.ahead + randomRange(sim, 0, 60)
    spawnCivilian(sim, s, lane, 'traffic')
  }
  if (oncoming < TRAFFIC.oncomingDensity * window * LANES) {
    spawnCivilian(sim, e.s + TRAFFIC.ahead + 200 + randomRange(sim, 0, 80), Math.floor(nextRandom(sim) * LANES), 'oncoming')
  }
}

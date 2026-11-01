import { nextRandom } from '../../../flyer/sim/rng'
import type { Agent, BodyKind, SimState } from '../types'

/**
 * Vision-only perception, simulated. Eight cameras give 360° coverage with a long forward
 * range; an object is detected when a sight line from the roof cameras to its center or one of
 * its near corners is not blocked by a taller-or-equal vehicle in between. Positions carry
 * range-dependent noise, and an alpha-beta filter per track estimates velocity, so what the
 * planner sees lags and jitters slightly behind ground truth. Tracks that drop out of sight
 * coast for a moment before they are forgotten.
 */

export type TrackKind = 'vehicle' | 'police' | 'block' | 'wreck' | 'oncoming'

export type Track = {
  id: number
  kind: TrackKind
  body: BodyKind
  s: number
  d: number
  vs: number
  vd: number
  as: number
  psi: number
  length: number
  width: number
  height: number
  signal: number
  braking: boolean
  visible: boolean
  lastSeen: number
  age: number
  /** Police ram threat, 0..1. */
  threat: number
  copState?: string
}

export type DetectedSpikes = { id: number; s: number; d0: number; d1: number }

const RANGE_FORWARD = 300
const RANGE_REAR = 120
const RANGE_SIDE = 90
const FORGET_AFTER = 1.2
const ALPHA = 0.55
const BETA = 0.18

function kindOf(a: Agent): TrackKind {
  if (a.role === 'oncoming') return 'oncoming'
  if (a.wrecked >= 0) return 'wreck'
  if (a.role === 'block') return 'block'
  if (a.role === 'cop') return 'police'
  return 'vehicle'
}

/** Does segment p0→p1 (in s, d) cross agent o's rectangle (shrunk slightly)? */
function blocks(o: Agent, s0: number, d0: number, s1: number, d1: number): boolean {
  const c = Math.cos(o.psi)
  const sn = Math.sin(o.psi)
  const toLocal = (s: number, d: number): [number, number] => {
    const x = s - o.s
    const y = d - o.d
    return [x * c + y * sn, -x * sn + y * c]
  }
  const [ax, ay] = toLocal(s0, d0)
  const [bx, by] = toLocal(s1, d1)
  const hx = o.length * 0.45
  const hy = o.width * 0.42
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dy = by - ay
  for (const [p, dp, h] of [
    [ax, dx, hx],
    [ay, dy, hy],
  ] as const) {
    if (Math.abs(dp) < 1e-9) {
      if (Math.abs(p) > h) return false
      continue
    }
    let ta = (-h - p) / dp
    let tb = (h - p) / dp
    if (ta > tb) [ta, tb] = [tb, ta]
    t0 = Math.max(t0, ta)
    t1 = Math.min(t1, tb)
    if (t0 > t1) return false
  }
  return true
}

export class Perception {
  readonly tracks = new Map<number, Track>()
  spikes: DetectedSpikes[] = []
  private readonly noise = { rng: 0x2f6e2b1 }
  private lastT = -1

  reset(): void {
    this.tracks.clear()
    this.spikes = []
    this.lastT = -1
  }

  private gauss(): number {
    return (nextRandom(this.noise) + nextRandom(this.noise) + nextRandom(this.noise) - 1.5) * 1.15
  }

  private visible(sim: SimState, target: Agent): boolean {
    const e = sim.ego
    const ds = target.s - e.s
    const dd = target.d - e.d
    const range = ds > 0 ? (Math.abs(dd) > Math.abs(ds) ? RANGE_SIDE : RANGE_FORWARD) : RANGE_REAR
    if (Math.hypot(ds, dd) > range) return false
    const cs = e.s + (ds > 0 ? 1.2 : -1.0)
    const cd = e.d
    // Sight lines to the center and the two corners nearest us.
    const near = target.s - Math.sign(ds) * target.length * 0.4
    const points: [number, number][] = [
      [target.s, target.d],
      [near, target.d - target.width * 0.45],
      [near, target.d + target.width * 0.45],
    ]
    const minS = Math.min(cs, target.s) - 10
    const maxS = Math.max(cs, target.s) + 10
    for (const [ps, pd] of points) {
      let clear = true
      for (const o of sim.agents) {
        if (o === target || o.s < minS || o.s > maxS) continue
        // Oncoming cars behind the median barrier only hide things over there.
        if ((o.role === 'oncoming') !== (target.role === 'oncoming') && o.height < 2.5) continue
        if (o.height < target.height - 0.35) continue
        if (blocks(o, cs, cd, ps, pd)) {
          clear = false
          break
        }
      }
      if (clear) return true
    }
    return false
  }

  update(sim: SimState): void {
    const now = sim.t
    const dt = this.lastT < 0 ? 0 : now - this.lastT
    this.lastT = now
    const e = sim.ego
    for (const a of sim.agents) {
      if (Math.abs(a.s - e.s) > RANGE_FORWARD + 20) continue
      if (!this.visible(sim, a)) continue
      const range = Math.hypot(a.s - e.s, a.d - e.d)
      const sigma = 0.04 + range * 0.0016
      const ms = a.s + this.gauss() * sigma * 2
      const md = a.d + this.gauss() * sigma
      const t = this.tracks.get(a.id)
      const kind = kindOf(a)
      if (!t || dt <= 0) {
        this.tracks.set(a.id, {
          id: a.id,
          kind,
          body: a.kind,
          s: ms,
          d: md,
          vs: a.v * a.dir,
          vd: a.vd,
          as: 0,
          psi: a.psi,
          length: a.length,
          width: a.width,
          height: a.height,
          signal: a.signal,
          braking: a.accel < -1,
          visible: true,
          lastSeen: now,
          age: 0,
          threat: 0,
          copState: a.role === 'cop' ? a.copState : undefined,
        })
        continue
      }
      // Alpha-beta filter. While unseen the track has already been coasted forward every
      // update, so the prediction only covers the time since the last update.
      const gap = now - t.lastSeen
      const ps = t.s + t.vs * dt
      const pd = t.d + t.vd * dt
      const rs = ms - ps
      const rd = md - pd
      t.s = ps + ALPHA * rs
      t.d = pd + ALPHA * rd
      const vsPrev = t.vs
      // After a gap, trust the new measurement for position but don't turn the jump into speed.
      const vGain = gap > dt * 1.5 ? BETA * 0.25 : BETA
      t.vs += (vGain * rs) / dt
      t.vd += (vGain * rd) / dt
      // Blend toward the true speed a little: radar-free, but the networks are good at it.
      t.vs += (a.v * a.dir - t.vs) * 0.25
      t.vd += (a.vd - t.vd) * 0.2
      // Traffic on a motorway doesn't reverse or teleport sideways.
      if (kind === 'vehicle' || kind === 'police') {
        t.vs = Math.max(-1, Math.min(95, t.vs))
        t.vd = Math.max(-4, Math.min(4, t.vd))
      }
      t.as += ((t.vs - vsPrev) / Math.max(dt, 1e-3) - t.as) * 0.15
      t.psi = a.psi
      t.kind = kind
      t.signal = a.signal
      t.braking = a.accel < -1.2
      t.visible = true
      t.lastSeen = now
      t.age += gap
      t.copState = a.role === 'cop' ? a.copState : undefined
    }
    for (const [id, t] of this.tracks) {
      if (t.lastSeen === now) continue
      t.visible = false
      const coast = Math.max(0, dt)
      t.s += t.vs * coast
      t.d += t.vd * coast
      if (now - t.lastSeen > FORGET_AFTER || Math.abs(t.s - e.s) > RANGE_FORWARD + 40) this.tracks.delete(id)
    }
    // Spike strips lie flat: seen from 200 m on a clear road.
    this.spikes = sim.spikes.filter((k) => k.s - e.s > -10 && k.s - e.s < 200 && !k.passed).map((k) => ({ id: k.id, s: k.s, d0: k.d0, d1: k.d1 }))

    // Police ram threat: alongside or right behind, closing in.
    for (const t of this.tracks.values()) {
      if (t.kind !== 'police') {
        t.threat = 0
        continue
      }
      const ds = t.s - e.s
      const dd = t.d - e.d
      const closing = -Math.sign(dd) * t.vd
      t.threat = Math.max(0, Math.min(1, (1 - Math.abs(ds) / 30) * (1 - Math.abs(dd) / 9) + (t.copState === 'ram' ? 0.4 : 0) + Math.max(0, closing) * 0.1))
    }
  }
}

import { LANES, laneCenter, laneOf } from '../config'
import { halfExtent } from '../collide'
import type { Ego } from '../types'
import type { DetectedSpikes, Track } from './perception'

/**
 * Predicted footprint of every tracked object at each planner sample time. Vehicles keep their
 * speed (and braking), drift laterally as they are moving, and complete a lane change when
 * their indicator is on or they are already moving across. Interceptors that are threatening a
 * ram are assumed to lunge at the hero car's current line.
 */

export type Predicted = {
  id: number
  kind: Track['kind']
  s: Float64Array
  d: Float64Array
  /** Footprint half-extents along s and d. */
  hs: number
  hd: number
  vs: number
  threat: number
  /** Directly behind us in our lane: they follow us, we don't dodge them. */
  follower: boolean
  static: boolean
  /** Scales the safety margins: flat spike strips need less room than a car. */
  margin: number
}

export function predict(tracks: Iterable<Track>, spikes: readonly DetectedSpikes[], ego: Ego, times: Float64Array): Predicted[] {
  const out: Predicted[] = []
  const n = times.length
  const egoHalfW = ego.width / 2
  for (const t of tracks) {
    if (t.kind === 'oncoming') continue
    // Stopped things matter from further away: at 250 km/h the car covers 280 m in four seconds.
    const slow = Math.abs(t.vs) < 3
    if (t.s - ego.s > (slow ? 290 : 240) || t.s - ego.s < -90) continue
    const s = new Float64Array(n)
    const d = new Float64Array(n)
    const fake = { id: t.id, s: t.s, d: t.d, v: t.vs, psi: t.psi, length: t.length, width: t.width }
    const hs = halfExtent(fake, 1, 0)
    const hd = halfExtent(fake, 0, 1)
    const isStatic = t.kind === 'block' || (t.kind === 'wreck' && Math.abs(t.vs) < 0.5)
    // Lateral intent.
    let targetD = t.d
    let latSpeed = t.vd
    if (t.kind === 'vehicle' || t.kind === 'police') {
      const lane = laneOf(t.d)
      if (t.signal !== 0 || Math.abs(t.vd) > 0.35) {
        const dir = t.signal !== 0 ? t.signal : Math.sign(t.vd)
        const goal = Math.max(0, Math.min(LANES - 1, lane - dir))
        targetD = laneCenter(goal)
        // Already past the line toward the goal: it's the nearest center in that direction.
        if (Math.sign(targetD - t.d) !== dir) targetD = laneCenter(lane)
        latSpeed = Math.max(Math.abs(t.vd), 1.0) * Math.sign(targetD - t.d)
      } else {
        targetD = laneCenter(lane)
        latSpeed = t.vd
      }
    }
    if (t.kind === 'police' && t.threat > 0.55 && !(t.s < ego.s - ego.length && Math.abs(t.d - ego.d) < 1.5)) {
      targetD = ego.d
      latSpeed = 3.2 * Math.sign(ego.d - t.d)
    }
    const decel = t.braking ? Math.min(0, t.as) : 0
    for (let k = 0; k < n; k++) {
      const tk = times[k]
      if (isStatic) {
        s[k] = t.s
        d[k] = t.d
        continue
      }
      // Braking until stopped.
      const tStop = decel < 0 ? Math.min(tk, t.vs / -decel) : tk
      s[k] = t.s + t.vs * tStop + 0.5 * decel * tStop * tStop
      const moved = latSpeed * tk
      if (targetD !== t.d && Math.sign(latSpeed) === Math.sign(targetD - t.d)) {
        d[k] = Math.abs(moved) >= Math.abs(targetD - t.d) ? targetD : t.d + moved
      } else {
        d[k] = t.d + t.vd * 0.8 * (1 - Math.exp(-tk / 0.8))
      }
    }
    const behind = t.s < ego.s - ego.length / 2
    const sameLane = Math.abs(t.d - ego.d) < hd + egoHalfW - 0.2
    out.push({
      id: t.id,
      kind: t.kind,
      s,
      d,
      hs,
      hd,
      vs: t.vs,
      threat: t.threat,
      follower: behind && sameLane,
      static: isStatic,
      margin: 1,
    })
  }
  for (const k of spikes) {
    const s = new Float64Array(n).fill(k.s)
    const mid = (k.d0 + k.d1) / 2
    const d = new Float64Array(n).fill(mid)
    out.push({ id: -k.id, kind: 'block', s, d, hs: 0.5, hd: (k.d1 - k.d0) / 2, vs: 0, threat: 0, follower: false, static: true, margin: 0.25 })
  }
  return out
}

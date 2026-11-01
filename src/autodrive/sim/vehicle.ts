import { BARRIER_HALF, EGO, GRAVITY, ROAD_EDGE } from './config'
import { halfWidthD } from './collide'
import type { Road } from './road'
import type { DriveCommand, Ego, SimEvent } from './types'

export function createEgo(s: number, d: number, v: number): Ego {
  return {
    id: 0,
    s,
    d,
    v,
    psi: 0,
    length: EGO.length,
    width: EGO.width,
    steer: 0,
    accel: 0,
    yawRate: 0,
    latAccel: 0,
    slip: 0,
    damage: 0,
    tiresBlown: false,
    odometer: 0,
    braking: false,
    signal: 0,
  }
}

/** Steady-state acceleration limits of the hero car at speed v. */
export function egoAccelLimit(v: number, blown: boolean): number {
  if (blown) return v > 16 ? 0 : 2.5
  if (v >= EGO.topSpeed) return 0
  return Math.min(EGO.maxAccel, EGO.power / (EGO.mass * Math.max(1, Math.abs(v))))
}

export function egoGrip(e: Ego): number {
  return EGO.grip * (e.tiresBlown ? 0.42 : 1) * GRAVITY
}

/**
 * Kinematic bicycle model integrated directly in Frenet coordinates, with a friction circle:
 * when the steering asks for more lateral acceleration than the tyres can give the car runs
 * wide (understeer), and lateral load takes grip away from braking and acceleration.
 */
export function stepEgo(e: Ego, cmd: DriveCommand, road: Road, dt: number, events: SimEvent[]): void {
  const grip = egoGrip(e)
  const target = Math.max(-EGO.maxSteer, Math.min(EGO.maxSteer, cmd.steer))
  const rate = EGO.steerRate * dt
  e.steer += Math.max(-rate, Math.min(rate, target - e.steer))
  if (e.tiresBlown) e.steer += Math.sin(e.odometer * 0.9) * 0.0016

  // Lateral.
  let r = (e.v * Math.tan(e.steer)) / EGO.wheelbase
  let aLat = e.v * r
  const excess = Math.abs(aLat) / grip
  if (excess > 1) {
    r /= excess
    aLat /= excess
  }
  e.yawRate = r
  e.latAccel = aLat

  // Longitudinal, inside what lateral load leaves of the friction circle.
  const lonGrip = Math.sqrt(Math.max(0.05, grip * grip - aLat * aLat))
  let a = cmd.accel
  // Rolling backwards (pushed by an impact) out of reverse gear: the brakes stop it.
  if (!cmd.reverse && e.v < 0) a = Math.max(0, Math.min(EGO.maxBrake, Math.abs(a) + 2))
  else if (a > 0) a = Math.min(a, e.v >= 0 ? egoAccelLimit(e.v, e.tiresBlown) : EGO.maxBrake, lonGrip)
  else a = Math.max(a, -Math.min(e.v > 0 ? EGO.maxBrake : 3.5, lonGrip))
  const resist = EGO.drag * e.v * Math.abs(e.v) + (Math.abs(e.v) > 0.05 ? EGO.rolling * Math.sign(e.v) : 0) + GRAVITY * road.grade(e.s) * 0.9
  const extraDrag = e.tiresBlown ? 0.9 * Math.sign(e.v) : 0
  const v0 = e.v
  e.v += (a - resist - extraDrag) * dt
  // Braking stops the car; only reverse gear drives it backwards.
  if (!cmd.reverse && v0 >= 0 && e.v < 0) e.v = 0
  if (v0 < 0 && e.v > 0) e.v = 0
  if (e.v < -EGO.maxReverse) e.v = -EGO.maxReverse
  e.accel = (e.v - v0) / dt
  e.braking = cmd.accel < -0.6 && e.v > 0.5
  e.slip = Math.max(0, Math.min(1, (excess - 0.92) * 4)) + (cmd.accel < -8.5 && e.v > 8 ? 0.6 : 0)
  if (cmd.signal !== undefined) e.signal = cmd.signal

  // Integrate in Frenet.
  const kappa = road.kappa(e.s)
  const sdot = (e.v * Math.cos(e.psi)) / (1 - kappa * e.d)
  e.s += sdot * dt
  e.d += e.v * Math.sin(e.psi) * dt
  e.psi += (r - kappa * sdot) * dt
  e.odometer += Math.abs(sdot * dt)
  if (e.psi > Math.PI) e.psi -= Math.PI * 2
  if (e.psi < -Math.PI) e.psi += Math.PI * 2

  // Median barrier and guard rail.
  const half = halfWidthD(e)
  const maxD = -BARRIER_HALF - half
  const minD = -ROAD_EDGE + half
  if (e.d > maxD || e.d < minD) {
    const side: 1 | -1 = e.d > maxD ? 1 : -1
    e.d = side > 0 ? maxD : minD
    const vLat = e.v * Math.sin(e.psi)
    const impact = Math.abs(vLat)
    // Glance off: kill the heading into the wall, scrub some speed.
    if (vLat * side > 0) e.psi *= -0.25
    e.v *= 1 - Math.min(0.25, impact * 0.02) - 0.15 * dt
    if (impact > 0.6) {
      e.damage = Math.min(1, e.damage + impact * 0.012)
      events.push({ type: 'barrier', impact, side })
    }
  }
}

import { EGO } from '../config'
import type { Road } from '../road'
import type { DriveCommand, Ego } from '../types'
import { sampleTrajectory, type Trajectory } from './planner'

/**
 * Trajectory tracking. Lateral control works in acceleration space so the gains don't change
 * with speed: the plan's lateral acceleration is fed forward, a PD loop on lateral position and
 * velocity (in the road frame) corrects errors, and the sum plus the road's own curvature is
 * turned into a front-wheel angle through the bicycle model. Speed follows the plan's
 * acceleration with proportional feedback on speed and position.
 */
const KP = 1.9
const KV = 2.6

export function trackTrajectory(tr: Trajectory, ego: Ego, road: Road, t: number): DriveCommand {
  const tau = t - tr.t0
  const look = tau + 0.06
  const d = sampleTrajectory(tr, look, 'd')
  const vd = sampleTrajectory(tr, look, 'vd')
  const ad = sampleTrajectory(tr, look, 'ad')
  const v = Math.max(2, Math.abs(ego.v))

  const egoVd = ego.v * Math.sin(ego.psi)
  const aLat = ad + KP * (d - ego.d) + KV * (vd - egoVd)
  // Curvature that gives this lateral acceleration on top of following the road.
  const kappa = (road.kappa(ego.s) * Math.cos(ego.psi) + aLat / (v * v)) * Math.sign(ego.v || 1)
  let steer = Math.atan(EGO.wheelbase * kappa)
  steer = Math.max(-EGO.maxSteer, Math.min(EGO.maxSteer, steer))

  const vRef = sampleTrajectory(tr, tau, 'vs')
  const sRef = sampleTrajectory(tr, tau, 's')
  const as = sampleTrajectory(tr, tau + 0.05, 'as')
  let accel = as + 1.3 * (vRef - ego.v) + 0.25 * Math.max(-4, Math.min(4, sRef - ego.s))
  if (vRef < 0.3 && ego.v < 0.6) accel = -3
  accel = Math.max(-EGO.maxBrake, Math.min(EGO.maxAccel, accel))
  return { accel, steer }
}

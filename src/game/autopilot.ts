import * as THREE from 'three'
import type { Track } from './track'
import type { DriveControls, Vehicle } from './vehicle/vehicle'

/** Simple line-following driver used for demo mode and headless handling checks. */
export function autopilot(track: Track, vehicle: Vehicle, hintIndex: number, lateralG = 1): DriveControls {
  const pos = vehicle.position
  const proj = track.project(pos.x, pos.z, hintIndex)
  const speed = Math.max(vehicle.speed, 0)
  const look = THREE.MathUtils.clamp(speed * 0.8, 8, 28)
  const target = track.pointAt(proj.distance + look).position
  const fwd = vehicle.forward.setY(0).normalize()
  const dir = target.sub(pos).setY(0).normalize()
  // Positive when the target is to the driver's right
  const angle = Math.atan2(fwd.x * dir.z - fwd.z * dir.x, fwd.dot(dir))

  let curvature = 0
  for (let d = 5; d <= 60; d += 5) {
    const a = track.pointAt(proj.distance + d).tangent
    const b = track.pointAt(proj.distance + d + 10).tangent
    curvature = Math.max(curvature, Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) / 10)
  }
  const vTarget = THREE.MathUtils.clamp(Math.sqrt((lateralG * 9.81) / Math.max(curvature, 1e-4)), 12, 40)

  // Lift when the tail steps out, so powerful or rear-driven cars do not spin on corner exit.
  const vel = vehicle.velocity.setY(0)
  const bodySlip = vel.lengthSq() > 4 ? fwd.angleTo(vel.normalize()) : 0
  const traction = THREE.MathUtils.clamp(1 - (bodySlip - 0.15) / 0.2, 0.2, 1)

  return {
    throttle: (speed < vTarget - 1 ? 1 : speed < vTarget ? 0.3 : 0) * traction,
    brake: speed > vTarget + 3 ? 0.8 : 0,
    steer: THREE.MathUtils.clamp(angle * 2.2, -1, 1),
    handbrake: 0,
  }
}

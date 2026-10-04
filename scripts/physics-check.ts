/**
 * Headless handling checks. Run with `npm run test:physics`.
 * Drives the car with scripted inputs and an autopilot, then checks the numbers stay in a sane range.
 */
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { createStage, PHYSICS_STEP } from '../src/game/stage'
import type { Surface } from '../src/game/track'
import { Vehicle, type DriveControls } from '../src/game/vehicle/vehicle'

const IDLE: DriveControls = { throttle: 0, brake: 0, steer: 0, handbrake: 0 }
const LATERAL_G = Number(process.env.LATERAL_G ?? 1.0)
const results: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail })
}

function run(world: RAPIER.World, vehicle: Vehicle, seconds: number, controls: (t: number) => DriveControls, onStep?: (t: number) => boolean | void) {
  const steps = Math.round(seconds / PHYSICS_STEP)
  for (let i = 0; i < steps; i++) {
    const t = i * PHYSICS_STEP
    vehicle.step(PHYSICS_STEP, controls(t))
    world.step()
    if (onStep?.(t) === true) return t
  }
  return seconds
}

function yawOf(v: Vehicle): number {
  const f = v.forward
  return Math.atan2(f.x, f.z)
}

function flatWorld(surface: Surface) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = PHYSICS_STEP
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0))
  const vehicle = new Vehicle(world, () => surface, new THREE.Vector3(0, 0.9, 0), 0)
  run(world, vehicle, 1.5, () => ({ ...IDLE, brake: 1 }))
  return { world, vehicle }
}

function kmh(v: Vehicle) {
  return v.velocity.length() * 3.6
}

await RAPIER.init()

// Acceleration and top speed
for (const surface of ['tarmac', 'gravel'] as Surface[]) {
  const { world, vehicle } = flatWorld(surface)
  let to100 = -1
  let maxKmh = 0
  run(world, vehicle, 30, () => ({ ...IDLE, throttle: 1 }), (t) => {
    const s = kmh(vehicle)
    maxKmh = Math.max(maxKmh, s)
    if (to100 < 0 && s >= 100) to100 = t
  })
  check(`0-100 km/h on ${surface}`, to100 > 2.5 && to100 < 8, `${to100.toFixed(2)} s`)
  check(`top speed on ${surface}`, maxKmh > 170 && maxKmh < 230, `${maxKmh.toFixed(0)} km/h, gear ${vehicle.gear}`)
}

// Braking from 100 km/h
for (const surface of ['tarmac', 'gravel'] as Surface[]) {
  const { world, vehicle } = flatWorld(surface)
  run(world, vehicle, 20, () => ({ ...IDLE, throttle: 1 }), () => kmh(vehicle) >= 100)
  const start = vehicle.position
  run(world, vehicle, 10, () => ({ ...IDLE, brake: 1 }), () => vehicle.speed < 0.5)
  const dist = vehicle.position.distanceTo(start)
  check(`100-0 braking on ${surface}`, dist > 25 && dist < 70, `${dist.toFixed(1)} m`)
}

// Steady cornering should not spin the car
{
  const { world, vehicle } = flatWorld('gravel')
  run(world, vehicle, 20, () => ({ ...IDLE, throttle: 1 }), () => kmh(vehicle) >= 70)
  let maxLat = 0
  let minUp = 1
  run(world, vehicle, 4, () => ({ ...IDLE, throttle: 0.45, steer: 0.5 }), () => {
    const v = vehicle.velocity
    const fwd = vehicle.forward
    const slip = Math.abs(Math.atan2(new THREE.Vector3().crossVectors(fwd, v).y, fwd.dot(v)))
    maxLat = Math.max(maxLat, slip)
    minUp = Math.min(minUp, vehicle.up.y)
  })
  check('gravel corner stays controllable', maxLat < 0.6 && minUp > 0.8, `max body slip ${(maxLat * 57.3).toFixed(1)}°, min up ${minUp.toFixed(2)}`)
}

// Handbrake turn rotates the car
{
  const { world, vehicle } = flatWorld('gravel')
  run(world, vehicle, 20, () => ({ ...IDLE, throttle: 1 }), () => kmh(vehicle) >= 60)
  const yaw0 = yawOf(vehicle)
  let minUp = 1
  run(world, vehicle, 0.9, () => ({ ...IDLE, steer: 1, handbrake: 1 }), () => {
    minUp = Math.min(minUp, vehicle.up.y)
  })
  let dyaw = Math.abs(yawOf(vehicle) - yaw0)
  if (dyaw > Math.PI) dyaw = Math.PI * 2 - dyaw
  check('handbrake turn rotates', dyaw > 0.6 && minUp > 0.7, `${(dyaw * 57.3).toFixed(0)}° yaw, min up ${minUp.toFixed(2)}`)
}

// Reverse
{
  const { world, vehicle } = flatWorld('gravel')
  run(world, vehicle, 3, () => ({ ...IDLE, brake: 1 }))
  check('reverse engages', vehicle.gear === -1 && vehicle.speed < -2, `gear ${vehicle.gear}, speed ${vehicle.speed.toFixed(1)} m/s`)
}

// Full stage: settle on the start line, then autopilot a lap
{
  const t0 = performance.now()
  const stage = await createStage()
  const buildMs = performance.now() - t0
  const { world, vehicle, race, track } = stage
  check('stage builds quickly', buildMs < 4000, `${buildMs.toFixed(0)} ms, track ${track.length.toFixed(0)} m, features ${track.features.map((f) => f.kind).join(',')}`)

  run(world, vehicle, 2, () => ({ ...IDLE, handbrake: 1 }))
  const startProj = track.project(vehicle.position.x, vehicle.position.z)
  const ride = vehicle.position.y - startProj.roadHeight
  check('settles on start line', vehicle.wheelsOnGround === 4 && Math.abs(vehicle.speed) < 0.2 && ride > 0.45 && ride < 0.85, `ride height ${ride.toFixed(2)} m, wheels ${vehicle.wheelsOnGround}`)

  let maxKmh = 0
  let airborne = 0
  let flips = 0
  let upsideDown = false
  let offRoad = 0
  let sumKmh = 0
  let samples = 0

  const autopilot = (): DriveControls => {
    const pos = vehicle.position
    const proj = track.project(pos.x, pos.z, race.trackIndex)
    const speed = Math.max(vehicle.speed, 0)
    const look = THREE.MathUtils.clamp(speed * 0.8, 8, 28)
    const target = track.pointAt(proj.distance + look).position
    const fwd = vehicle.forward.setY(0).normalize()
    const dir = target.sub(pos).setY(0).normalize()
    // Positive when the target is to the driver's right
    const angle = Math.atan2(fwd.x * dir.z - fwd.z * dir.x, fwd.dot(dir))
    const steer = THREE.MathUtils.clamp(angle * 2.2, -1, 1)

    let curvature = 0
    for (let d = 5; d <= 60; d += 5) {
      const a = track.pointAt(proj.distance + d).tangent
      const b = track.pointAt(proj.distance + d + 10).tangent
      curvature = Math.max(curvature, Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) / 10)
    }
    const vTarget = THREE.MathUtils.clamp(Math.sqrt((LATERAL_G * 9.81) / Math.max(curvature, 1e-4)), 12, 40)
    return {
      throttle: speed < vTarget - 1 ? 1 : speed < vTarget ? 0.3 : 0,
      brake: speed > vTarget + 3 ? 0.8 : 0,
      steer,
      handbrake: 0,
    }
  }

  let controls = autopilot()
  const lapTime = run(world, vehicle, 150, () => controls, (t) => {
    if (Math.round(t / PHYSICS_STEP) % 6 === 0) controls = autopilot()
    race.update(PHYSICS_STEP, vehicle.position, true)
    const s = kmh(vehicle)
    maxKmh = Math.max(maxKmh, s)
    sumKmh += s
    samples++
    if (vehicle.wheelsOnGround === 0) airborne += PHYSICS_STEP
    if (Math.abs(race.lateral) > track.halfWidth + track.shoulder) {
      if (process.env.DEBUG && offRoad === 0) console.log('off road at', race.progress.toFixed(0), 'm', s.toFixed(0), 'km/h', 'lat', race.lateral.toFixed(1))
      offRoad += PHYSICS_STEP
    }
    if (process.env.DEBUG && Math.round(t / PHYSICS_STEP) % 120 === 0) {
      console.log(t.toFixed(0), 's', race.progress.toFixed(0), 'm', s.toFixed(0), 'km/h lat', race.lateral.toFixed(1), 'gear', vehicle.gear, 'air', vehicle.wheelsOnGround)
    }
    const up = vehicle.up.y
    if (up < 0.2 && !upsideDown) {
      flips++
      upsideDown = true
    } else if (up > 0.8) upsideDown = false
    return race.progress >= track.length
  })

  check('autopilot completes a lap', race.progress >= track.length, `${lapTime.toFixed(1)} s, progress ${race.progress.toFixed(0)}/${track.length.toFixed(0)} m`)
  check('no rollovers on a clean lap', flips === 0, `${flips} rollovers`)
  check('stays on the road', offRoad < 3, `${offRoad.toFixed(1)} s off road`)
  check('jumps and crests get air', airborne > 0.15, `${airborne.toFixed(2)} s fully airborne`)
  check('lap pace', maxKmh > 70 && sumKmh / samples > 40, `max ${maxKmh.toFixed(0)} km/h, avg ${(sumKmh / samples).toFixed(0)} km/h`)
}

let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(36)} ${r.detail}`)
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)

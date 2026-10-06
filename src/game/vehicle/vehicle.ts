import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { Surface } from '../track'
import { CAR, SURFACES, torqueAt } from './config'

export type DriveControls = {
  throttle: number
  brake: number
  /** -1 full left, +1 full right. */
  steer: number
  handbrake: number
}

export type Wheel = {
  local: THREE.Vector3
  front: boolean
  left: boolean
  inContact: boolean
  compression: number
  compressionVelocity: number
  /** Current spring length, 0..restLength. */
  suspensionLength: number
  load: number
  contactPoint: THREE.Vector3
  contactNormal: THREE.Vector3
  surface: Surface
  /** Sliding speed at the contact patch in m/s, drives dust and sound. */
  slip: number
  spin: number
  angularVelocity: number
  steer: number
}

export type SurfaceResolver = (x: number, z: number) => Surface

const UP = new THREE.Vector3(0, 1, 0)
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _up = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _lin = new THREE.Vector3()
const _ang = new THREE.Vector3()
const _com = new THREE.Vector3()
const _mount = new THREE.Vector3()
const _wf = new THREE.Vector3()
const _fwdP = new THREE.Vector3()
const _sideP = new THREE.Vector3()
const _rel = new THREE.Vector3()
const _vp = new THREE.Vector3()
const _force = new THREE.Vector3()
const _point = new THREE.Vector3()

function lateralCurve(slipAngle: number): number {
  return Math.sin(1.4 * Math.atan(9 * slipAngle))
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export class Vehicle {
  readonly body: RAPIER.RigidBody
  readonly wheels: Wheel[]
  gear = 1
  rpm = CAR.idleRpm
  steerAngle = 0
  /** Signed speed along the car's nose, m/s. */
  speed = 0
  throttle = 0

  private shiftTimer = 0
  private reverseTimer = 0
  private readonly world: RAPIER.World
  private readonly surfaceAt: SurfaceResolver
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  private cornerMass = CAR.mass / 4

  constructor(world: RAPIER.World, surfaceAt: SurfaceResolver, position: THREE.Vector3, yaw: number) {
    this.world = world
    this.surfaceAt = surfaceAt

    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw)
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setAngularDamping(0.25)
        .setAdditionalMassProperties(CAR.mass, CAR.centerOfMass, CAR.inertia, { x: 0, y: 0, z: 0, w: 1 }),
    )

    const he = CAR.halfExtents
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z).setDensity(0).setFriction(0.35).setRestitution(0.1),
      this.body,
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.68, 0.22, 0.85).setTranslation(0, 0.48, -0.2).setDensity(0).setFriction(0.4),
      this.body,
    )

    const layout: [number, number, boolean, boolean][] = [
      [CAR.halfTrack, CAR.frontAxle, true, true],
      [-CAR.halfTrack, CAR.frontAxle, true, false],
      [CAR.halfTrack, CAR.rearAxle, false, true],
      [-CAR.halfTrack, CAR.rearAxle, false, false],
    ]
    this.wheels = layout.map(([x, z, front, left]) => ({
      local: new THREE.Vector3(x, CAR.mountY, z),
      front,
      left,
      inContact: false,
      compression: 0,
      compressionVelocity: 0,
      suspensionLength: CAR.restLength,
      load: 0,
      contactPoint: new THREE.Vector3(),
      contactNormal: new THREE.Vector3(0, 1, 0),
      surface: 'gravel' as Surface,
      slip: 0,
      spin: 0,
      angularVelocity: 0,
      steer: 0,
    }))
  }

  /** Picks up mass and inertia after `CAR` changes; the wheel layout is shared by every car. */
  applyCar(): void {
    this.cornerMass = CAR.mass / 4
    this.body.setAdditionalMassProperties(CAR.mass, CAR.centerOfMass, CAR.inertia, { x: 0, y: 0, z: 0, w: 1 }, true)
    for (const w of this.wheels) w.local.y = CAR.mountY
  }

  reset(position: THREE.Vector3, yaw: number): void {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw)
    this.body.setTranslation(position, true)
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.gear = 1
    this.rpm = CAR.idleRpm
    this.steerAngle = 0
    this.speed = 0
    this.shiftTimer = 0
    this.reverseTimer = 0
    for (const w of this.wheels) {
      w.compression = 0
      w.compressionVelocity = 0
      w.angularVelocity = 0
      w.inContact = false
    }
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation()
    return new THREE.Vector3(t.x, t.y, t.z)
  }

  get quaternion(): THREE.Quaternion {
    const r = this.body.rotation()
    return new THREE.Quaternion(r.x, r.y, r.z, r.w)
  }

  get velocity(): THREE.Vector3 {
    const v = this.body.linvel()
    return new THREE.Vector3(v.x, v.y, v.z)
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion)
  }

  get up(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion)
  }

  get wheelsOnGround(): number {
    return this.wheels.reduce((n, w) => n + (w.inContact ? 1 : 0), 0)
  }

  /** Surface under most of the tyres, or null when airborne. */
  get surface(): Surface | null {
    const counts: Partial<Record<Surface, number>> = {}
    let best: Surface | null = null
    for (const w of this.wheels) {
      if (!w.inContact) continue
      counts[w.surface] = (counts[w.surface] ?? 0) + 1
      if (!best || counts[w.surface]! > counts[best]!) best = w.surface
    }
    return best
  }

  step(dt: number, c: DriveControls): void {
    const t = this.body.translation()
    const r = this.body.rotation()
    _pos.set(t.x, t.y, t.z)
    _quat.set(r.x, r.y, r.z, r.w)
    _up.set(0, 1, 0).applyQuaternion(_quat)
    _fwd.set(0, 0, 1).applyQuaternion(_quat)
    _right.set(-1, 0, 0).applyQuaternion(_quat)
    const lv = this.body.linvel()
    _lin.set(lv.x, lv.y, lv.z)
    const av = this.body.angvel()
    _ang.set(av.x, av.y, av.z)
    const com = this.body.worldCom()
    _com.set(com.x, com.y, com.z)

    this.speed = _lin.dot(_fwd)
    const absSpeed = Math.abs(this.speed)

    const { drive, brake } = this.updateGearbox(dt, c, absSpeed)
    const wheelForce = this.updateEngine(dt, drive, absSpeed)
    this.updateSteering(dt, c, absSpeed)
    this.updateSuspension(dt)

    const handbrake = c.handbrake > 0.5
    for (const w of this.wheels) {
      const split = w.front ? (1 - CAR.rearTorqueSplit) / 2 : CAR.rearTorqueSplit / 2
      this.applyTyre(w, dt, wheelForce * split, brake, handbrake && !w.front, drive)
    }

    if (this.wheelsOnGround === 0) {
      // Bleed off pitch and roll in the air so landings stay recoverable
      const yawRate = _ang.dot(_up)
      _force.copy(_ang).addScaledVector(_up, -yawRate).multiplyScalar(-CAR.airStabilization * CAR.inertia.x * dt)
      this.body.applyTorqueImpulse(_force, true)
    }

    const speedSq = _lin.lengthSq()
    if (speedSq > 0.01) {
      const v = Math.sqrt(speedSq)
      _force.copy(_lin).multiplyScalar(-CAR.drag * v * dt)
      _force.addScaledVector(_up, -CAR.downforce * speedSq * dt)
      this.body.applyImpulse(_force, true)
    }
  }

  private updateGearbox(dt: number, c: DriveControls, absSpeed: number) {
    let drive: number
    let brake: number

    if (this.gear > 0) {
      drive = c.throttle
      brake = c.brake
      if (this.speed < 0.8 && c.brake > 0.5 && c.throttle < 0.1) {
        this.reverseTimer += dt
        if (this.reverseTimer > 0.3) {
          this.gear = -1
          this.reverseTimer = 0
        }
      } else this.reverseTimer = 0
    } else {
      drive = c.brake
      brake = c.throttle
      if (this.speed > -0.8 && c.throttle > 0.5 && c.brake < 0.1) {
        this.reverseTimer += dt
        if (this.reverseTimer > 0.15) {
          this.gear = 1
          this.reverseTimer = 0
        }
      } else this.reverseTimer = 0
    }

    this.shiftTimer = Math.max(0, this.shiftTimer - dt)
    if (this.gear > 0 && this.shiftTimer === 0) {
      const rpm = this.rpmFromSpeed(absSpeed, CAR.gears[this.gear - 1])
      if (rpm > CAR.upshiftRpm && this.gear < CAR.gears.length) {
        this.gear++
        this.shiftTimer = CAR.shiftTime
      } else if (this.gear > 1) {
        const lower = this.rpmFromSpeed(absSpeed, CAR.gears[this.gear - 2])
        if (rpm < CAR.downshiftRpm && lower < CAR.upshiftRpm - 600) {
          this.gear--
          this.shiftTimer = CAR.shiftTime * 0.6
        }
      }
    }

    this.throttle = drive
    return { drive, brake }
  }

  private rpmFromSpeed(absSpeed: number, ratio: number): number {
    return ((absSpeed / CAR.wheelRadius) * 60 * ratio * CAR.finalDrive) / (2 * Math.PI)
  }

  /** Returns total tractive force at the wheels (N), signed for direction of travel. */
  private updateEngine(dt: number, drive: number, absSpeed: number): number {
    const ratio = this.gear > 0 ? CAR.gears[this.gear - 1] : CAR.reverseRatio
    const rawRpm = this.rpmFromSpeed(absSpeed, ratio)
    let rpm = Math.max(rawRpm, CAR.idleRpm)
    if (Math.abs(this.gear) === 1 && drive > 0.05) rpm = Math.max(rpm, CAR.idleRpm + drive * (CAR.launchRpm - CAR.idleRpm))
    rpm = Math.min(rpm, CAR.redline)
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 18)

    const gearing = (ratio * CAR.finalDrive * CAR.drivetrainEfficiency) / CAR.wheelRadius
    const direction = this.gear > 0 ? 1 : -1

    if (this.shiftTimer > 0) return 0
    if (drive > 0.05) {
      const torque = rawRpm >= CAR.redline ? 0 : torqueAt(rpm) * drive
      return torque * gearing * direction
    }
    if (absSpeed > 1) {
      return -Math.sign(this.speed) * CAR.engineBrakeTorque * (rpm / CAR.redline) * gearing
    }
    return 0
  }

  private updateSteering(dt: number, c: DriveControls, absSpeed: number): void {
    const maxSteer = THREE.MathUtils.lerp(CAR.maxSteer, CAR.highSpeedSteer, Math.min(1, absSpeed / 38))
    let target = c.steer * maxSteer
    if (this.speed > 5) {
      const bodySlip = Math.atan2(_lin.dot(_right), Math.max(this.speed, 1))
      target += CAR.countersteerAssist * bodySlip * (1 - Math.abs(c.steer) * 0.5)
    }
    target = THREE.MathUtils.clamp(target, -CAR.maxSteer, CAR.maxSteer)
    const maxDelta = CAR.steerRate * dt
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -maxDelta, maxDelta)
  }

  private updateSuspension(dt: number): void {
    const maxToi = CAR.restLength + CAR.wheelRadius
    this.ray.dir = { x: -_up.x, y: -_up.y, z: -_up.z }

    for (const w of this.wheels) {
      _mount.copy(w.local).applyQuaternion(_quat).add(_pos)
      this.ray.origin = { x: _mount.x, y: _mount.y, z: _mount.z }
      const hit = this.world.castRayAndGetNormal(this.ray, maxToi, true, undefined, undefined, undefined, this.body)

      let compression = 0
      if (hit) {
        const length = hit.timeOfImpact - CAR.wheelRadius
        compression = CAR.restLength - length
        w.inContact = true
        w.suspensionLength = THREE.MathUtils.clamp(length, 0, CAR.restLength)
        w.contactPoint.copy(_mount).addScaledVector(_up, -hit.timeOfImpact)
        w.contactNormal.set(hit.normal.x, hit.normal.y, hit.normal.z)
        w.surface = this.surfaceAt(w.contactPoint.x, w.contactPoint.z)
      } else {
        w.inContact = false
        w.suspensionLength = CAR.restLength
      }

      w.compressionVelocity = THREE.MathUtils.clamp((compression - w.compression) / dt, -5, 5)
      w.compression = compression

      if (!w.inContact) {
        w.load = 0
        continue
      }
      const damper = w.compressionVelocity > 0 ? CAR.damperBump : CAR.damperRebound
      const bump = compression > CAR.restLength ? (compression - CAR.restLength) * CAR.bumpStopRate : 0
      w.load = Math.max(0, compression * CAR.springRate + w.compressionVelocity * damper + bump)
    }

    for (const [l, r, k] of [
      [0, 1, CAR.antiRollFront],
      [2, 3, CAR.antiRollRear],
    ] as const) {
      const wl = this.wheels[l]
      const wr = this.wheels[r]
      const f = (wl.compression - wr.compression) * k
      if (wl.inContact) wl.load = Math.max(0, wl.load + f)
      if (wr.inContact) wr.load = Math.max(0, wr.load - f)
    }

    for (const w of this.wheels) {
      if (!w.inContact) continue
      _mount.copy(w.local).applyQuaternion(_quat).add(_pos)
      _force.copy(_up).multiplyScalar(w.load * dt)
      this.body.applyImpulseAtPoint(_force, _mount, true)
    }
  }

  private applyTyre(w: Wheel, dt: number, driveForce: number, brake: number, locked: boolean, drive: number): void {
    w.steer = w.front ? this.steerAngle : 0

    if (!w.inContact) {
      w.slip = 0
      w.angularVelocity = locked ? 0 : w.angularVelocity * 0.995 + drive * 2 * dt * 60
      w.spin += w.angularVelocity * dt
      return
    }

    const n = w.contactNormal
    _wf.copy(_fwd)
    if (w.front) _wf.applyAxisAngle(_up, -this.steerAngle)
    _fwdP.copy(_wf).addScaledVector(n, -_wf.dot(n)).normalize()
    _sideP.crossVectors(n, _fwdP).normalize()

    _rel.subVectors(w.contactPoint, _com)
    _vp.crossVectors(_ang, _rel).add(_lin)
    const vLong = _vp.dot(_fwdP)
    const vLat = _vp.dot(_sideP)

    const surf = SURFACES[w.surface]
    const slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 2.5))
    const sliding = smoothstep(0.25, 0.7, Math.abs(slipAngle))
    const mu = THREE.MathUtils.lerp(surf.grip, surf.slide, sliding)
    const maxF = mu * w.load

    let fx: number
    let fy: number

    if (locked) {
      const slideF = surf.slide * CAR.handbrakeGrip * w.load
      const vPlanar = Math.hypot(vLong, vLat)
      if (vPlanar > 0.5) {
        fx = (-vLong / vPlanar) * slideF
        fy = (-vLat / vPlanar) * slideF
      } else {
        fx = THREE.MathUtils.clamp((-vLong * this.cornerMass) / dt, -slideF, slideF)
        fy = THREE.MathUtils.clamp((-vLat * this.cornerMass) / dt, -slideF, slideF)
      }
      w.slip = vPlanar
      w.angularVelocity = 0
    } else {
      fy = -maxF * lateralCurve(slipAngle)
      fx = driveForce - surf.rolling * w.load * THREE.MathUtils.clamp(vLong, -1, 1)

      if (brake > 0) {
        const bf = brake * (w.front ? CAR.brakeFront : CAR.brakeRear)
        fx += Math.abs(vLong) > 0.4 ? -Math.sign(vLong) * bf : THREE.MathUtils.clamp((-vLong * this.cornerMass) / dt, -bf, bf)
      }

      const requested = Math.hypot(fx, fy)
      let wheelspin = 0
      if (requested > maxF && requested > 0) {
        const scale = maxF / requested
        wheelspin = (Math.abs(fx) * (1 - scale)) / Math.max(maxF, 1)
        fx *= scale
        fy *= scale
      }

      w.slip = Math.abs(vLat) + wheelspin * 8
      const spinBoost = driveForce !== 0 ? Math.sign(driveForce) * wheelspin * 25 : 0
      w.angularVelocity = vLong / CAR.wheelRadius + spinBoost
    }

    w.spin += w.angularVelocity * dt

    _force.copy(_fwdP).multiplyScalar(fx * dt).addScaledVector(_sideP, fy * dt)
    _point.copy(w.contactPoint).addScaledVector(n, 0.12)
    this.body.applyImpulseAtPoint(_force, _point, true)
  }
}

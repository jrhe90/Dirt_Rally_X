import * as THREE from 'three'
import type { InputState } from './input'
import type { Track } from './track'

const MAX_SPEED = 48
const ACCEL = 28
const BRAKE = 38
const DRAG = 0.35
const ROLLING = 2.2
const STEER_SPEED = 2.1
const STEER_GRIP = 0.72
const DIRT_SLIP = 0.55
const HANDBRAKE_SLIP = 0.22

export class Car {
  readonly mesh: THREE.Group
  readonly velocity = new THREE.Vector3()
  heading = 0
  speed = 0
  slip = 0
  progress = 0
  lap = 1
  finished = false

  private lastProgress = 0
  private wheelMeshes: THREE.Mesh[] = []
  private body: THREE.Group
  private steerAngle = 0
  private track: Track

  constructor(track: Track) {
    this.track = track
    this.mesh = new THREE.Group()
    this.body = this.buildMesh()
    this.mesh.add(this.body)
    this.reset()
  }

  reset(): void {
    const start = this.track.sampleAtDistance(2)
    this.mesh.position.copy(start.position)
    this.mesh.position.addScaledVector(start.normal, 0.55)
    this.heading = Math.atan2(start.tangent.x, start.tangent.z)
    this.mesh.rotation.set(0, this.heading, 0)
    this.velocity.set(0, 0, 0)
    this.speed = 0
    this.slip = 0
    this.progress = 2
    this.lastProgress = 2
    this.lap = 1
    this.finished = false
    this.steerAngle = 0
  }

  update(dt: number, input: InputState): void {
    if (this.finished) {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 2))
      this.mesh.position.addScaledVector(this.velocity, dt)
      return
    }

    // Steering — less responsive at high speed, more on dirt
    const speedFactor = 1 - THREE.MathUtils.clamp(Math.abs(this.speed) / MAX_SPEED, 0, 0.75)
    const steerTarget = input.steer * STEER_SPEED * speedFactor
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, steerTarget, 1 - Math.exp(-10 * dt))

    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading))
    const right = new THREE.Vector3(forward.z, 0, -forward.x)

    // Longitudinal forces
    if (input.throttle) {
      this.velocity.addScaledVector(forward, ACCEL * input.throttle * dt)
    }
    if (input.brake) {
      const brakeDir = this.speed > 0.5 ? -1 : this.speed < -0.5 ? 1 : -Math.sign(this.speed || 1)
      this.velocity.addScaledVector(forward, BRAKE * input.brake * brakeDir * dt * (this.speed >= 0 ? 1 : 0.4))
      // Allow reverse when nearly stopped
      if (Math.abs(this.speed) < 2 && input.brake) {
        this.velocity.addScaledVector(forward, -ACCEL * 0.45 * dt)
      }
    }

    // Drag / rolling
    this.velocity.addScaledVector(this.velocity, -DRAG * dt)
    if (this.velocity.lengthSq() > 0.0001) {
      const rolling = this.velocity.clone().normalize().multiplyScalar(-ROLLING * dt)
      this.velocity.add(rolling)
    }

    // Lateral grip — dirt is slippery; handbrake dumps grip
    const grip = input.handbrake ? HANDBRAKE_SLIP : DIRT_SLIP * STEER_GRIP
    const lateralVel = right.dot(this.velocity)
    this.velocity.addScaledVector(right, -lateralVel * (1 - Math.exp(-grip * 8 * dt)))
    this.slip = Math.abs(lateralVel)

    // Rotate heading from steering + slip yaw
    this.speed = forward.dot(this.velocity)
    const yawRate = this.steerAngle * THREE.MathUtils.clamp(this.speed / 12, -1.4, 1.4)
    const slipYaw = THREE.MathUtils.clamp(lateralVel * 0.015, -0.8, 0.8)
    this.heading += (yawRate + slipYaw * (input.handbrake ? 1.6 : 0.35)) * dt

    // Integrate
    this.mesh.position.addScaledVector(this.velocity, dt)

    // Snap to track surface + off-track drag
    const { sample, lateral } = this.track.project(this.mesh.position)
    this.mesh.position.y = sample.position.y + 0.55

    // Soft walls at berms
    const maxLat = this.track.halfWidth + 1.8
    if (Math.abs(lateral) > maxLat) {
      const push = (Math.abs(lateral) - maxLat) * Math.sign(lateral)
      this.mesh.position.addScaledVector(sample.binormal, -push)
      this.velocity.addScaledVector(sample.binormal, -push * 4)
      this.velocity.multiplyScalar(0.85)
    } else if (Math.abs(lateral) > this.track.halfWidth) {
      // Shoulder — more drag
      this.velocity.multiplyScalar(1 - 1.8 * dt)
    }

    // Bank / pitch toward track
    const targetQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      sample.normal,
    )
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.heading,
    )
    const desired = targetQuat.clone().multiply(yawQuat)
    this.mesh.quaternion.slerp(desired, 1 - Math.exp(-8 * dt))

    // Body lean into turns
    this.body.rotation.z = THREE.MathUtils.lerp(
      this.body.rotation.z,
      -this.steerAngle * 0.12 - lateralVel * 0.01,
      1 - Math.exp(-6 * dt),
    )
    this.body.rotation.x = THREE.MathUtils.lerp(
      this.body.rotation.x,
      -THREE.MathUtils.clamp(this.speed * 0.002, -0.08, 0.08),
      1 - Math.exp(-6 * dt),
    )

    // Wheel spin
    const spin = this.speed * dt * 1.2
    for (const w of this.wheelMeshes) {
      w.rotation.x += spin
    }

    // Lap progress along track
    this.updateProgress(sample.distance)
  }

  private updateProgress(distance: number): void {
    let delta = distance - this.lastProgress
    if (delta < -this.track.length * 0.5) delta += this.track.length
    if (delta > this.track.length * 0.5) delta -= this.track.length

    // Only count forward progress
    if (delta > 0 && delta < 40) {
      this.progress += delta
    }
    this.lastProgress = distance

    const lapsDone = Math.floor(this.progress / this.track.length)
    this.lap = Math.min(3, lapsDone + 1)
    if (lapsDone >= 3) {
      this.finished = true
    }
  }

  private buildMesh(): THREE.Group {
    const g = new THREE.Group()

    const paint = new THREE.MeshStandardMaterial({
      color: 0xd4572a,
      roughness: 0.45,
      metalness: 0.15,
    })
    const dark = new THREE.MeshStandardMaterial({
      color: 0x1e1712,
      roughness: 0.7,
      metalness: 0.2,
    })
    const glass = new THREE.MeshStandardMaterial({
      color: 0x8ec8e0,
      roughness: 0.15,
      metalness: 0.4,
      transparent: true,
      opacity: 0.75,
    })
    const accent = new THREE.MeshStandardMaterial({
      color: 0xe8d5b0,
      roughness: 0.5,
      metalness: 0.1,
    })

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 3.4), paint)
    body.position.y = 0.45
    body.castShadow = true
    g.add(body)

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.5, 1.5), paint)
    cabin.position.set(0, 0.9, -0.15)
    cabin.castShadow = true
    g.add(cabin)

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.35, 0.08), glass)
    windshield.position.set(0, 0.95, 0.55)
    windshield.rotation.x = -0.35
    g.add(windshield)

    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 1.1), paint)
    hood.position.set(0, 0.72, 1.0)
    g.add(hood)

    // Rally lights
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xfff2d0,
      emissive: 0xffcc66,
      emissiveIntensity: 0.8,
    })
    for (const x of [-0.45, 0.45]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10), lightMat)
      lamp.rotation.x = Math.PI / 2
      lamp.position.set(x, 0.55, 1.72)
      g.add(lamp)
    }

    // Spoiler
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.35), dark)
    spoiler.position.set(0, 1.15, -1.45)
    g.add(spoiler)

    // Stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.56, 3.42), accent)
    stripe.position.y = 0.45
    g.add(stripe)

    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.9,
    })
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0x999999,
      metalness: 0.6,
      roughness: 0.35,
    })
    const wheelPositions: [number, number, number][] = [
      [-0.9, 0.32, 1.1],
      [0.9, 0.32, 1.1],
      [-0.9, 0.32, -1.15],
      [0.9, 0.32, -1.15],
    ]

    for (const [x, y, z] of wheelPositions) {
      const wheel = new THREE.Group()
      wheel.position.set(x, y, z)

      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.32, 12), wheelMat)
      tire.rotation.z = Math.PI / 2
      tire.castShadow = true
      wheel.add(tire)

      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 8), hubMat)
      hub.rotation.z = Math.PI / 2
      wheel.add(hub)

      g.add(wheel)
      this.wheelMeshes.push(tire)
    }

    // Skid plate / underside shadow cue
    const under = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 3.0), dark)
    under.position.y = 0.18
    g.add(under)

    return g
  }
}

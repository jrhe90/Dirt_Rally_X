import * as THREE from 'three'
import type { Terrain } from './terrain'
import type { Vehicle } from './vehicle/vehicle'

type Mode = 'chase' | 'far' | 'bonnet'
const MODES: Mode[] = ['chase', 'far', 'bonnet']
const CHASE = {
  chase: { distance: 6.4, height: 2.2 },
  far: { distance: 9.5, height: 3.4 },
}
const BASE_FOV = 62
const SPEED_FOV = 10

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private mode: Mode = 'chase'
  private readonly dir = new THREE.Vector3(0, 0, 1)
  private smoothY = 0
  private readonly terrain: Terrain

  constructor(aspect: number, terrain: Terrain) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 900)
    this.terrain = terrain
  }

  get modeName(): Mode {
    return this.mode
  }

  cycle(): void {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]
  }

  snap(vehicle: Vehicle): void {
    this.dir.copy(vehicle.forward).setY(0).normalize()
    this.smoothY = vehicle.position.y
    this.update(0, vehicle)
  }

  update(dt: number, vehicle: Vehicle): void {
    const pos = vehicle.position
    const speed = vehicle.velocity.length()
    const fovTarget = BASE_FOV + SPEED_FOV * Math.min(1, speed / 42)
    this.camera.fov += (fovTarget - this.camera.fov) * (dt > 0 ? 1 - Math.exp(-3 * dt) : 1)
    this.camera.updateProjectionMatrix()

    if (this.mode === 'bonnet') {
      const q = vehicle.quaternion
      this.camera.position.copy(pos).add(new THREE.Vector3(0, 0.62, 0.95).applyQuaternion(q))
      this.camera.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))
      this.smoothY = pos.y
      return
    }

    const fwd = vehicle.forward.setY(0)
    if (fwd.lengthSq() > 1e-4) fwd.normalize()
    const vel = vehicle.velocity.setY(0)
    const target = fwd.clone()
    if (vel.length() > 4 && vel.dot(fwd) > 0) target.lerp(vel.normalize(), 0.45).normalize()
    if (dt > 0) {
      this.dir.lerp(target, 1 - Math.exp(-4 * dt)).normalize()
      this.smoothY += (pos.y - this.smoothY) * (1 - Math.exp(-7 * dt))
    }

    const { distance, height } = CHASE[this.mode]
    const anchor = new THREE.Vector3(pos.x, this.smoothY, pos.z)
    const camPos = anchor.clone().addScaledVector(this.dir, -distance)
    camPos.y += height
    const ground = this.terrain.heightAt(camPos.x, camPos.z) + 0.8
    if (camPos.y < ground) camPos.y = ground

    this.camera.position.copy(camPos)
    this.camera.lookAt(anchor.clone().addScaledVector(this.dir, 3.5).setY(anchor.y + 0.9))
  }
}

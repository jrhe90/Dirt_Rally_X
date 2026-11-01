import * as THREE from 'three'

/**
 * Hot-pursuit style chase camera: low and close behind the car, lagging a touch in yaw so the
 * car swings in the frame through corners, field of view opening up with speed, and shake on
 * impacts. Other views: a higher chase, bonnet, a slow cinematic orbit, and a top-down view.
 */
export type CameraMode = 'chase' | 'far' | 'hood' | 'orbit' | 'top'
export const CAMERA_MODES: CameraMode[] = ['chase', 'far', 'hood', 'orbit', 'top']

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 9000)
  mode: CameraMode = 'chase'
  private yaw = 0
  private pitch = 0
  private readonly pos = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private trauma = 0
  private time = 0
  private fov = 60
  private initialized = false
  private orbit = 0

  resize(w: number, h: number): void {
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  cut(): void {
    this.initialized = false
  }

  next(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]
    this.initialized = false
    return this.mode
  }

  update(x: number, y: number, z: number, yaw: number, pitch: number, speed: number, latAccel: number, dt: number): void {
    this.time += dt
    const portrait = this.camera.aspect < 1
    if (!this.initialized) {
      this.yaw = yaw
      this.pitch = pitch
    }
    // Yaw lag: tighter at speed so the car doesn't drift out of frame.
    let dyaw = yaw - this.yaw
    while (dyaw > Math.PI) dyaw -= Math.PI * 2
    while (dyaw < -Math.PI) dyaw += Math.PI * 2
    this.yaw += dyaw * Math.min(1, dt * (this.mode === 'hood' ? 20 : 5.5))
    this.pitch += (pitch - this.pitch) * Math.min(1, dt * 4)
    const fx = Math.cos(this.yaw)
    const fz = -Math.sin(this.yaw)
    const lx = -Math.sin(this.yaw)
    const lz = -Math.cos(this.yaw)
    const kmh = speed * 3.6
    const sp = THREE.MathUtils.clamp(kmh / 250, 0, 1)

    let fovTarget = 58 + sp * 22
    const want = new THREE.Vector3()
    const look = new THREE.Vector3()
    const side = THREE.MathUtils.clamp(-latAccel * 0.06, -0.6, 0.6)
    switch (this.mode) {
      case 'chase': {
        const back = (portrait ? 8.4 : 6.4) - sp * 0.9
        const up = (portrait ? 2.6 : 1.85) - sp * 0.15
        want.set(x - fx * back + lx * side, y + up + Math.sin(this.pitch) * back * 0.5, z - fz * back + lz * side)
        look.set(x + fx * 6, y + 0.95, z + fz * 6)
        break
      }
      case 'far': {
        want.set(x - fx * 13, y + 4.4, z - fz * 13)
        look.set(x + fx * 8, y + 0.8, z + fz * 8)
        fovTarget = 55 + sp * 12
        break
      }
      case 'hood': {
        want.set(x + fx * 0.4, y + 1.22, z + fz * 0.4)
        look.set(x + fx * 30, y + 0.9, z + fz * 30)
        fovTarget = 70 + sp * 14
        break
      }
      case 'orbit': {
        this.orbit += dt * 0.18
        const a = this.yaw + Math.PI + Math.sin(this.orbit) * 1.6
        want.set(x + Math.cos(a) * 9, y + 1.4 + Math.sin(this.orbit * 0.7) * 0.6, z - Math.sin(a) * 9)
        look.set(x, y + 0.8, z)
        fovTarget = 42
        break
      }
      case 'top': {
        want.set(x - fx * 22, y + 30, z - fz * 22)
        look.set(x + fx * 30, y, z + fz * 30)
        fovTarget = 52
        break
      }
    }
    if (!this.initialized) {
      this.pos.copy(want)
      this.look.copy(look)
      this.initialized = true
    } else {
      const k = this.mode === 'hood' ? 1 : Math.min(1, dt * 14)
      this.pos.lerp(want, k)
      this.look.lerp(look, Math.min(1, dt * 18))
    }
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 2.5)
    this.camera.fov = portrait ? this.fov * 1.25 : this.fov
    this.camera.updateProjectionMatrix()

    this.trauma = Math.max(0, this.trauma - dt * 1.4)
    const shake = this.trauma * this.trauma + sp * sp * 0.012
    const t = this.time
    const jx = (Math.sin(t * 37.1) + Math.sin(t * 23.7)) * 0.5 * shake * 0.35
    const jy = (Math.sin(t * 41.3) + Math.sin(t * 29.1)) * 0.5 * shake * 0.25
    this.camera.position.set(this.pos.x + lx * jx, this.pos.y + jy, this.pos.z + lz * jx)
    this.camera.lookAt(this.look)
    if (this.mode === 'chase') this.camera.rotateZ(side * -0.035)
  }
}

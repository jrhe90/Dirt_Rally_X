import * as THREE from 'three'
import { CEILING_Y } from '../sim/config'
import type { SimState } from '../sim/types'

/**
 * Elevated three-quarter view from behind and to the side of the car, like the reference clip.
 * Gameplay is 2D (x along the road, y up), so on every resize the camera is fitted to keep a
 * fixed box in view: from just behind the car to some distance ahead, and from the road to the
 * flight ceiling. Portrait screens swing further behind the car so the road runs up the screen
 * and the box can stay large.
 */

type Layout = {
  azimuth: number
  elevation: number
  fov: number
  /** Meters of road kept in view behind and ahead of the car. */
  behind: number
  ahead: number
}

/** Debug close-ups of the car (`?showcase=front|rear|side|three|rear-three`): camera offset and look offset from the car. */
const SHOWCASE: Record<string, [number, number, number, number, number, number]> = {
  front: [6.2, 0.45, 0.05, 0, -0.1, 0],
  rear: [-6.2, 0.9, 1.4, 0, -0.05, 0],
  side: [0.1, 0.25, 7.2, 0, -0.1, 0],
  three: [4.6, 1.3, 4.4, 0, -0.15, 0],
  'rear-three': [-4.8, 1.2, 4.2, 0, -0.1, 0],
}
const showcase = SHOWCASE[new URLSearchParams(window.location.search).get('showcase') ?? '']

const LANDSCAPE: Layout = { azimuth: 0.42, elevation: 0.2, fov: 36, behind: 5, ahead: 44 }
const PORTRAIT: Layout = { azimuth: 1.0, elevation: 0.42, fov: 50, behind: 5, ahead: 34 }

/** Where the fitted box must land, in normalized device coordinates (leaves room for the HUD). */
const NDC = { left: -0.9, right: 0.92, bottom: -0.78, top: 0.72 }

function mix(a: Layout, b: Layout, f: number): Layout {
  const out = {} as Layout
  for (const k of Object.keys(a) as (keyof Layout)[]) out[k] = a[k] + (b[k] - a[k]) * f
  return out
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private layout = LANDSCAPE
  /** Camera position and look target relative to (car x, 0, 0), from the fit. */
  private readonly offset = new THREE.Vector3()
  private readonly lookOffset = new THREE.Vector3()
  private trauma = 0
  private crashLean = 0
  private time = 0

  constructor() {
    this.camera = new THREE.PerspectiveCamera(LANDSCAPE.fov, 1, 0.5, 2000)
  }

  resize(width: number, height: number): void {
    const aspect = width / height
    // 0 at 16:10 or wider, 1 at 9:19.5 portrait.
    const f = THREE.MathUtils.clamp((1.6 - aspect) / (1.6 - 0.46), 0, 1)
    this.layout = mix(LANDSCAPE, PORTRAIT, f)
    this.camera.aspect = aspect
    this.camera.fov = showcase ? 30 : this.layout.fov
    this.camera.updateProjectionMatrix()
    this.fit()
  }

  /** Iteratively place the camera so the gameplay box fills the NDC window. */
  private fit(): void {
    const L = this.layout
    const dir = new THREE.Vector3(
      -Math.sin(L.azimuth) * Math.cos(L.elevation),
      Math.sin(L.elevation),
      Math.cos(L.azimuth) * Math.cos(L.elevation),
    )
    const corners = [
      new THREE.Vector3(-L.behind, 0, 0),
      new THREE.Vector3(L.ahead, 0, 0),
      new THREE.Vector3(-L.behind, CEILING_Y + 0.8, 0),
      new THREE.Vector3(L.ahead, CEILING_Y + 0.8, 0),
    ]
    const target = new THREE.Vector3((L.ahead - L.behind) / 2, CEILING_Y / 2, 0)
    let distance = 40
    const cam = this.camera
    const p = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    for (let i = 0; i < 40; i++) {
      cam.position.copy(target).addScaledVector(dir, distance)
      cam.lookAt(target)
      cam.updateMatrixWorld()
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (const c of corners) {
        p.copy(c).project(cam)
        x0 = Math.min(x0, p.x)
        x1 = Math.max(x1, p.x)
        y0 = Math.min(y0, p.y)
        y1 = Math.max(y1, p.y)
      }
      const scale = Math.max((x1 - x0) / (NDC.right - NDC.left), (y1 - y0) / (NDC.top - NDC.bottom))
      // Shift the target so the box's center lands on the window's center (in view space).
      const dx = ((x0 + x1) / 2 - (NDC.left + NDC.right) / 2) / 2
      const dy = ((y0 + y1) / 2 - (NDC.bottom + NDC.top) / 2) / 2
      const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * distance
      right.setFromMatrixColumn(cam.matrixWorld, 0)
      up.setFromMatrixColumn(cam.matrixWorld, 1)
      target.addScaledVector(right, dx * 2 * halfH * cam.aspect * 0.5).addScaledVector(up, dy * 2 * halfH * 0.5)
      distance *= 1 + (scale - 1) * 0.6
    }
    this.offset.copy(cam.position)
    this.lookOffset.copy(target)
  }

  /** Add screen shake (0–1); it decays on its own. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  update(s: SimState, dt: number): void {
    this.time += dt
    const crashed = s.phase === 'crashed' || s.phase === 'over'
    // After a crash, ease the view back so the tumbling car sits mid-screen.
    this.crashLean += ((crashed ? -12 : 0) - this.crashLean) * Math.min(1, dt * 1.2)
    const x = s.car.x + this.crashLean
    this.camera.position.set(x + this.offset.x, this.offset.y, this.offset.z)
    this.camera.lookAt(x + this.lookOffset.x, this.lookOffset.y, this.lookOffset.z)
    if (showcase) {
      const [px, py, pz, lx, ly, lz] = showcase
      this.camera.position.set(s.car.x + px, s.car.y + py, pz)
      this.camera.lookAt(s.car.x + lx, s.car.y + ly, lz)
      return
    }

    if (this.trauma > 0) {
      const t = this.trauma * this.trauma
      const n = (k: number) => Math.sin(this.time * (37 + k * 11) + k * 1.7) * Math.sin(this.time * (23 + k * 5))
      this.camera.position.x += n(1) * 0.9 * t
      this.camera.position.y += n(2) * 0.7 * t
      this.camera.rotation.z += n(3) * 0.03 * t
      this.trauma = Math.max(0, this.trauma - dt * 1.6)
    }
  }
}

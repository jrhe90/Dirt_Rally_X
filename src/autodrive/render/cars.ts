import * as THREE from 'three'
import type { BodyKind } from '../sim/types'
import { carParts, wheelGeometry } from './carModels'

/** Paint colours for civilian traffic (linear RGB). */
const PALETTE: [number, number, number][] = [
  [0.82, 0.83, 0.84],
  [0.5, 0.52, 0.55],
  [0.035, 0.037, 0.042],
  [0.16, 0.17, 0.19],
  [0.5, 0.03, 0.03],
  [0.03, 0.09, 0.32],
  [0.22, 0.42, 0.62],
  [0.04, 0.16, 0.09],
  [0.75, 0.55, 0.06],
  [0.72, 0.22, 0.03],
  [0.25, 0.03, 0.06],
  [0.55, 0.48, 0.36],
]
const EGO_PAINT: [number, number, number] = [0.62, 0.02, 0.025]
const COP_PAINT: [number, number, number] = [0.9, 0.9, 0.92]

export type CarShared = {
  paints: THREE.MeshPhysicalMaterial[]
  egoPaint: THREE.MeshPhysicalMaterial
  copPaint: THREE.MeshPhysicalMaterial
  glass: THREE.MeshPhysicalMaterial
  trim: THREE.MeshStandardMaterial
  tire: THREE.MeshStandardMaterial
  rim: THREE.MeshStandardMaterial
  head: THREE.MeshBasicMaterial
  blob: THREE.MeshBasicMaterial
}

function paint(c: [number, number, number], metal = 0.55): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(...c),
    vertexColors: true,
    metalness: metal,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.25,
  })
}

function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.85)')
  g.addColorStop(0.6, 'rgba(0,0,0,0.45)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

export function createCarShared(): CarShared {
  return {
    paints: PALETTE.map((c, i) => paint(c, i === 2 || i === 3 ? 0.35 : 0.6)),
    egoPaint: paint(EGO_PAINT, 0.45),
    copPaint: paint(COP_PAINT, 0.3),
    glass: new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.012, 0.015, 0.02), metalness: 0.3, roughness: 0.03, clearcoat: 1, envMapIntensity: 1.7 }),
    trim: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.02, 0.02, 0.022), roughness: 0.55, metalness: 0.2 }),
    tire: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.025, 0.025, 0.025), roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.63, 0.65), roughness: 0.28, metalness: 1 }),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.6, 5.8), fog: false }),
    blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  }
}

const TAIL_ON = new THREE.Color(1.1, 0.015, 0.02)
const BRAKE_ON = new THREE.Color(4.5, 0.05, 0.05)
const IND_OFF = new THREE.Color(0.3, 0.12, 0.0)
const IND_ON = new THREE.Color(5, 1.9, 0.1)
const RED = new THREE.Color(18, 0.6, 0.4)
const BLUE = new THREE.Color(0.6, 1.8, 22)
const DARK = new THREE.Color(0.08, 0.02, 0.02)
const DARK_B = new THREE.Color(0.01, 0.02, 0.09)

/** One drawable car: body meshes, spinning wheels and its own light materials. */
export class CarView {
  readonly group = new THREE.Group()
  readonly kind: BodyKind
  readonly color: number
  private readonly wheels: { obj: THREE.Object3D; pivot: THREE.Object3D; r: number; front: boolean; sign: number }[] = []
  private readonly tail = new THREE.MeshBasicMaterial({ color: TAIL_ON.clone() })
  private readonly indL = new THREE.MeshBasicMaterial({ color: IND_OFF.clone() })
  private readonly indR = new THREE.MeshBasicMaterial({ color: IND_OFF.clone() })
  private readonly barRed: THREE.MeshBasicMaterial | null = null
  private readonly barBlue: THREE.MeshBasicMaterial | null = null
  private readonly body: THREE.Group
  private spin = 0
  readonly height: number

  constructor(kind: BodyKind, color: number, shared: CarShared, shadows: boolean) {
    this.kind = kind
    this.color = color
    const p = carParts(kind)
    this.height = p.height
    this.body = new THREE.Group()
    this.group.add(this.body)
    const paintMat = kind === 'ego' ? shared.egoPaint : kind === 'cop' ? shared.copPaint : shared.paints[color % shared.paints.length]
    const add = (g: THREE.BufferGeometry | null, m: THREE.Material, cast = true) => {
      if (!g) return
      const mesh = new THREE.Mesh(g, m)
      mesh.castShadow = cast && shadows
      mesh.receiveShadow = shadows
      this.body.add(mesh)
    }
    add(p.body, paintMat)
    add(p.glass, shared.glass)
    add(p.roof, paintMat)
    add(p.trim, kind === 'truck' ? shared.paints[(color + 1) % 2] : shared.trim)
    add(p.head, shared.head, false)
    add(p.tail, this.tail, false)
    add(p.indicatorL, this.indL, false)
    add(p.indicatorR, this.indR, false)
    if (p.lightbar) {
      this.barRed = new THREE.MeshBasicMaterial({ color: RED.clone() })
      this.barBlue = new THREE.MeshBasicMaterial({ color: BLUE.clone() })
      add(p.lightbar[0], this.barRed, false)
      add(p.lightbar[1], this.barBlue, false)
    }
    const wg = wheelGeometry()
    for (const w of p.wheels) {
      const pivot = new THREE.Object3D()
      pivot.position.set(w.x, w.r, w.z)
      const obj = new THREE.Group()
      const tire = new THREE.Mesh(wg.tire, shared.tire)
      const rim = new THREE.Mesh(wg.rim, shared.rim)
      tire.castShadow = shadows
      obj.add(tire, rim)
      obj.scale.set(w.r, w.r, 1)
      const sign = w.z < 0 ? -1 : 1
      if (sign < 0) obj.rotation.y = Math.PI
      pivot.add(obj)
      this.group.add(pivot)
      this.wheels.push({ obj, pivot, r: w.r, front: w.front, sign })
    }
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(p.length * 1.15, p.width * 1.5).rotateX(-Math.PI / 2), shared.blob)
    blob.position.y = 0.03
    blob.renderOrder = 1
    this.group.add(blob)
  }

  /**
   * Place and animate. `yaw` is the world yaw, `pitch` follows the road grade, `roll` leans
   * into corners. `steer` turns the front wheels.
   */
  update(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, speed: number, dt: number, steer: number, braking: boolean, signal: number, time: number, siren: boolean): void {
    this.group.position.set(x, y, z)
    this.group.rotation.set(0, yaw, 0, 'YXZ')
    this.body.rotation.set(roll, 0, pitch, 'YXZ')
    this.spin += (speed * dt) / 0.34
    for (const w of this.wheels) {
      w.obj.rotation.z = -this.spin * (0.34 / w.r) * w.sign
      w.pivot.rotation.y = w.front ? steer : 0
    }
    this.tail.color.copy(braking ? BRAKE_ON : TAIL_ON)
    const blink = Math.floor(time * 2.6) % 2 === 0
    this.indL.color.copy(signal > 0 && blink ? IND_ON : IND_OFF)
    this.indR.color.copy(signal < 0 && blink ? IND_ON : IND_OFF)
    if (this.barRed && this.barBlue) {
      const phase = Math.floor(time * 7) % 4
      const on = siren
      this.barRed.color.copy(on && (phase === 0 || phase === 2) ? RED : DARK)
      this.barBlue.color.copy(on && (phase === 1 || phase === 3) ? BLUE : DARK_B)
    }
  }

  dispose(): void {
    this.tail.dispose()
    this.indL.dispose()
    this.indR.dispose()
    this.barRed?.dispose()
    this.barBlue?.dispose()
  }
}

/** Reuses car views by kind and colour so traffic churn doesn't rebuild meshes. */
export class CarPool {
  private readonly free = new Map<string, CarView[]>()
  private readonly shared: CarShared
  private readonly scene: THREE.Scene
  private readonly shadows: boolean

  constructor(scene: THREE.Scene, shared: CarShared, shadows: boolean) {
    this.scene = scene
    this.shared = shared
    this.shadows = shadows
  }

  take(kind: BodyKind, color: number): CarView {
    const key = `${kind}:${kind === 'cop' ? 0 : color}`
    const list = this.free.get(key)
    const view = list?.pop() ?? new CarView(kind, color, this.shared, this.shadows)
    this.scene.add(view.group)
    return view
  }

  give(view: CarView): void {
    this.scene.remove(view.group)
    const key = `${view.kind}:${view.kind === 'cop' ? 0 : view.color}`
    const list = this.free.get(key) ?? []
    list.push(view)
    this.free.set(key, list)
  }
}

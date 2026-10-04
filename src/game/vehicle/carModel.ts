import * as THREE from 'three'
import { CAR } from './config'
import type { Vehicle } from './vehicle'

export class CarModel {
  readonly group = new THREE.Group()
  private readonly wheels: { steer: THREE.Group; spin: THREE.Group }[] = []

  constructor() {
    this.buildBody()
    this.buildWheels()
  }

  sync(vehicle: Vehicle): void {
    const t = vehicle.body.translation()
    const r = vehicle.body.rotation()
    this.group.position.set(t.x, t.y, t.z)
    this.group.quaternion.set(r.x, r.y, r.z, r.w)

    vehicle.wheels.forEach((w, i) => {
      const visual = this.wheels[i]
      visual.steer.position.set(w.local.x, w.local.y - w.suspensionLength, w.local.z)
      visual.steer.rotation.y = -w.steer
      visual.spin.rotation.x = w.spin
    })
  }

  private buildBody(): void {
    const paint = new THREE.MeshStandardMaterial({ color: 0xd4572a, roughness: 0.38, metalness: 0.25 })
    const paintDark = new THREE.MeshStandardMaterial({ color: 0xa8401c, roughness: 0.45, metalness: 0.2 })
    const trim = new THREE.MeshStandardMaterial({ color: 0x1c1714, roughness: 0.7, metalness: 0.2 })
    const white = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.5 })
    const glass = new THREE.MeshStandardMaterial({ color: 0x1e2a30, roughness: 0.1, metalness: 0.6 })
    const lamp = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffd080, emissiveIntensity: 1.4 })
    const tail = new THREE.MeshStandardMaterial({ color: 0x7a0e0e, emissive: 0xff2010, emissiveIntensity: 0.6 })

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y, z)
      mesh.rotation.x = rx
      mesh.castShadow = true
      this.group.add(mesh)
      return mesh
    }

    add(new THREE.BoxGeometry(1.7, 0.5, 3.9), paint, 0, 0, 0)
    add(new THREE.BoxGeometry(1.74, 0.22, 0.24), trim, 0, -0.16, 1.98)
    add(new THREE.BoxGeometry(1.74, 0.22, 0.24), trim, 0, -0.16, -1.98)
    add(new THREE.BoxGeometry(1.76, 0.12, 3.5), trim, 0, -0.24, 0)

    add(new THREE.BoxGeometry(1.58, 0.08, 1.25), paintDark, 0, 0.28, 1.3)
    add(new THREE.BoxGeometry(0.5, 0.1, 0.45), trim, 0, 0.34, 1.1)

    add(new THREE.BoxGeometry(1.4, 0.46, 1.65), paint, 0, 0.48, -0.25)
    add(new THREE.BoxGeometry(1.32, 0.42, 0.06), glass, 0, 0.5, 0.62, -0.5)
    add(new THREE.BoxGeometry(1.3, 0.36, 0.06), glass, 0, 0.5, -1.1, 0.45)
    add(new THREE.BoxGeometry(1.42, 0.28, 1.2), glass, 0, 0.53, -0.25)

    add(new THREE.BoxGeometry(0.32, 0.02, 3.92), white, 0, 0.26, 0)
    add(new THREE.BoxGeometry(0.32, 0.02, 1.66), white, 0, 0.72, -0.25)

    add(new THREE.BoxGeometry(1.8, 0.06, 0.42), trim, 0, 0.82, -1.78)
    add(new THREE.BoxGeometry(0.06, 0.3, 0.2), trim, -0.6, 0.62, -1.78)
    add(new THREE.BoxGeometry(0.06, 0.3, 0.2), trim, 0.6, 0.62, -1.78)

    for (const x of [-0.6, -0.2, 0.2, 0.6]) {
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), lamp, x, 0.06, 2.0, Math.PI / 2)
    }
    for (const x of [-0.65, 0.65]) {
      add(new THREE.BoxGeometry(0.32, 0.12, 0.04), tail, x, 0.08, -1.96)
    }

    for (const z of [CAR.frontAxle - 0.42, CAR.rearAxle - 0.42]) {
      for (const x of [-0.78, 0.78]) add(new THREE.BoxGeometry(0.3, 0.3, 0.03), trim, x, -0.36, z)
    }

    const decal = createDoorNumber()
    if (decal) {
      const mat = new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.5 })
      for (const side of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), mat)
        plate.position.set(side * 0.856, 0.02, -0.15)
        plate.rotation.y = side * (Math.PI / 2)
        this.group.add(plate)
      }
    }
  }

  private buildWheels(): void {
    const tyre = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 })
    const rim = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.35, metalness: 0.7 })
    const tyreGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.26, 18).rotateZ(Math.PI / 2)
    const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.27, 12).rotateZ(Math.PI / 2)
    const spokeGeo = new THREE.BoxGeometry(0.28, 0.05, 0.4)

    for (let i = 0; i < 4; i++) {
      const steer = new THREE.Group()
      const spin = new THREE.Group()
      steer.add(spin)

      const t = new THREE.Mesh(tyreGeo, tyre)
      t.castShadow = true
      spin.add(t)
      spin.add(new THREE.Mesh(rimGeo, rim))
      spin.add(new THREE.Mesh(spokeGeo, rim))
      const spoke2 = new THREE.Mesh(spokeGeo, rim)
      spoke2.rotation.x = Math.PI / 2
      spin.add(spoke2)

      this.group.add(steer)
      this.wheels.push({ steer, spin })
    }
  }
}

function createDoorNumber(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 172
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f0e6d2'
  ctx.beginPath()
  ctx.roundRect(8, 8, 240, 156, 22)
  ctx.fill()
  ctx.fillStyle = '#1c1714'
  ctx.font = 'bold 118px "Bebas Neue", Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('27', 128, 94)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

import * as THREE from 'three'
import type { Surface } from './track'
import { SURFACES } from './vehicle/config'
import type { Vehicle } from './vehicle/vehicle'

const TINTS: Record<Surface, THREE.Color> = {
  gravel: new THREE.Color(0.66, 0.5, 0.34),
  grass: new THREE.Color(0.46, 0.42, 0.28),
  tarmac: new THREE.Color(0.72, 0.72, 0.7),
}

export class DustSystem {
  readonly points: THREE.Points
  private readonly capacity: number
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly alphas: Float32Array
  private readonly sizes: Float32Array
  private readonly velocities: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly startSize: Float32Array
  private readonly material: THREE.ShaderMaterial
  private cursor = 0
  private readonly carry = [0, 0, 0, 0]

  constructor(capacity: number) {
    this.capacity = capacity
    this.positions = new Float32Array(capacity * 3).fill(-9999)
    this.colors = new Float32Array(capacity * 3)
    this.alphas = new Float32Array(capacity)
    this.sizes = new Float32Array(capacity)
    this.velocities = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity).fill(1)
    this.startSize = new Float32Array(capacity)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float depth = max(-mv.z, 0.1);
          gl_PointSize = min(aSize * uScale / depth, uScale * 0.35);
          vColor = aColor;
          // Fade particles that are about to fill the screen
          vAlpha = aAlpha * smoothstep(1.5, 6.0, depth);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }
      `,
    })

    this.points = new THREE.Points(geo, this.material)
    this.points.frustumCulled = false
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))
  }

  emitFromVehicle(vehicle: Vehicle, dt: number): void {
    const vel = vehicle.velocity
    const speed = vel.length()
    vehicle.wheels.forEach((w, i) => {
      if (!w.inContact) return
      const surf = SURFACES[w.surface]
      const rate = (w.slip * 4 + Math.max(0, speed - 3) * 0.9) * surf.dust * (w.front ? 0.5 : 1)
      this.carry[i] += rate * dt
      const count = Math.floor(this.carry[i])
      this.carry[i] -= count
      for (let k = 0; k < count; k++) this.spawn(w.contactPoint, vel, TINTS[w.surface], speed)
    })
  }

  private spawn(at: THREE.Vector3, carVel: THREE.Vector3, tint: THREE.Color, speed: number): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.capacity
    const p = i * 3
    this.positions[p] = at.x + (Math.random() - 0.5) * 0.4
    this.positions[p + 1] = at.y + 0.1
    this.positions[p + 2] = at.z + (Math.random() - 0.5) * 0.4
    this.velocities[p] = carVel.x * 0.25 + (Math.random() - 0.5) * 2.5
    this.velocities[p + 1] = 0.6 + Math.random() * 1.6
    this.velocities[p + 2] = carVel.z * 0.25 + (Math.random() - 0.5) * 2.5
    const shade = 0.88 + Math.random() * 0.2
    this.colors[p] = tint.r * shade
    this.colors[p + 1] = tint.g * shade
    this.colors[p + 2] = tint.b * shade
    this.maxLife[i] = 1.2 + Math.random() * 1.6 + speed * 0.02
    this.life[i] = this.maxLife[i]
    this.startSize[i] = 0.6 + Math.random() * 0.6
  }

  update(dt: number): void {
    const drag = Math.exp(-1.6 * dt)
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0
        continue
      }
      this.life[i] -= dt
      const p = i * 3
      this.velocities[p] *= drag
      this.velocities[p + 1] = this.velocities[p + 1] * drag + 0.15 * dt
      this.velocities[p + 2] *= drag
      this.positions[p] += this.velocities[p] * dt
      this.positions[p + 1] += this.velocities[p + 1] * dt
      this.positions[p + 2] += this.velocities[p + 2] * dt

      const age = 1 - Math.max(0, this.life[i]) / this.maxLife[i]
      this.sizes[i] = this.startSize[i] * (1 + age * 5)
      this.alphas[i] = Math.min(1, age * 8) * (1 - age) * 0.32
    }

    const geo = this.points.geometry
    geo.getAttribute('position').needsUpdate = true
    geo.getAttribute('aColor').needsUpdate = true
    geo.getAttribute('aAlpha').needsUpdate = true
    geo.getAttribute('aSize').needsUpdate = true
  }
}

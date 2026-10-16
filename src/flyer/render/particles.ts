import * as THREE from 'three'

/**
 * Camera-facing particle quads drawn as one instanced mesh. Smoke uses normal blending with a
 * soft, noisy puff; glow uses additive blending for sparks, jet sparkle and pickups.
 */

const VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute float iSize;
  attribute vec4 iColor;
  attribute float iRot;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vSeed;
  void main() {
    vUv = uv;
    vColor = iColor;
    vSeed = iRot;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 p = (uv - 0.5) * iSize;
    mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    gl_Position = projectionMatrix * mv;
  }
`

const SMOKE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vSeed;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }
  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    float n = noise(p * 5.0 + vSeed * 3.0) * 0.6 + noise(p * 11.0 - vSeed) * 0.4;
    float a = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.55);
    gl_FragColor = vec4(vColor.rgb * (0.85 + 0.3 * n), vColor.a * a);
  }
`

const GLOW_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = exp(-d * d * 5.0) * smoothstep(1.0, 0.7, d);
    gl_FragColor = vec4(vColor.rgb * a * vColor.a, 1.0);
  }
`

export type EmitOptions = {
  life: number
  size0: number
  size1: number
  color: readonly [number, number, number]
  alpha: number
  /** Velocity damping per second. */
  drag?: number
  /** Upward acceleration (buoyancy, or negative for gravity). */
  rise?: number
  spin?: number
}

export class Particles {
  readonly mesh: THREE.Mesh
  private readonly capacity: number
  private count = 0
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly size: Float32Array
  private readonly color: Float32Array
  private readonly physics: Float32Array
  private readonly rot: Float32Array
  private readonly iPos: THREE.InstancedBufferAttribute
  private readonly iSize: THREE.InstancedBufferAttribute
  private readonly iColor: THREE.InstancedBufferAttribute
  private readonly iRot: THREE.InstancedBufferAttribute
  private readonly geometry: THREE.InstancedBufferGeometry

  constructor(capacity: number, kind: 'smoke' | 'glow') {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 3)
    this.vel = new Float32Array(capacity * 3)
    this.age = new Float32Array(capacity)
    this.life = new Float32Array(capacity)
    this.size = new Float32Array(capacity * 2)
    this.color = new Float32Array(capacity * 4)
    this.physics = new Float32Array(capacity * 3)
    this.rot = new Float32Array(capacity * 2)

    const quad = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = quad.index
    g.setAttribute('position', quad.attributes.position)
    g.setAttribute('uv', quad.attributes.uv)
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage)
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.iRot = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iPos', this.iPos)
    g.setAttribute('iSize', this.iSize)
    g.setAttribute('iColor', this.iColor)
    g.setAttribute('iRot', this.iRot)
    g.instanceCount = 0
    this.geometry = g

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: kind === 'smoke' ? SMOKE_FRAGMENT : GLOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: kind === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending,
    })
    this.mesh = new THREE.Mesh(g, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = kind === 'smoke' ? 2 : 3
  }

  get full(): boolean {
    return this.count >= this.capacity
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: EmitOptions): void {
    if (this.count >= this.capacity) return
    const i = this.count++
    const v = i * 3
    this.pos[v] = x
    this.pos[v + 1] = y
    this.pos[v + 2] = z
    this.vel[v] = vx
    this.vel[v + 1] = vy
    this.vel[v + 2] = vz
    this.age[i] = 0
    this.life[i] = o.life * (0.8 + Math.random() * 0.4)
    this.size[i * 2] = o.size0
    this.size[i * 2 + 1] = o.size1
    this.color[i * 4] = o.color[0]
    this.color[i * 4 + 1] = o.color[1]
    this.color[i * 4 + 2] = o.color[2]
    this.color[i * 4 + 3] = o.alpha
    this.physics[v] = o.drag ?? 0
    this.physics[v + 1] = o.rise ?? 0
    this.rot[i * 2] = Math.random() * Math.PI * 2
    this.rot[i * 2 + 1] = (Math.random() - 0.5) * (o.spin ?? 0.6)
  }

  clear(): void {
    this.count = 0
    this.geometry.instanceCount = 0
  }

  update(dt: number): void {
    let i = 0
    while (i < this.count) {
      this.age[i] += dt
      if (this.age[i] >= this.life[i]) {
        this.moveLastTo(i)
        continue
      }
      const damp = Math.exp(-this.physics[i * 3] * dt)
      const v = i * 3
      this.vel[v] *= damp
      this.vel[v + 1] = this.vel[v + 1] * damp + this.physics[i * 3 + 1] * dt
      this.vel[v + 2] *= damp
      this.pos[v] += this.vel[v] * dt
      this.pos[v + 1] = Math.max(0.05, this.pos[v + 1] + this.vel[v + 1] * dt)
      this.pos[v + 2] += this.vel[v + 2] * dt
      this.rot[i * 2] += this.rot[i * 2 + 1] * dt
      i++
    }

    const pos = this.iPos.array as Float32Array
    const size = this.iSize.array as Float32Array
    const color = this.iColor.array as Float32Array
    const rot = this.iRot.array as Float32Array
    for (let j = 0; j < this.count; j++) {
      const f = this.age[j] / this.life[j]
      const grow = 1 - (1 - f) * (1 - f)
      pos[j * 3] = this.pos[j * 3]
      pos[j * 3 + 1] = this.pos[j * 3 + 1]
      pos[j * 3 + 2] = this.pos[j * 3 + 2]
      size[j] = this.size[j * 2] + (this.size[j * 2 + 1] - this.size[j * 2]) * grow
      color[j * 4] = this.color[j * 4]
      color[j * 4 + 1] = this.color[j * 4 + 1]
      color[j * 4 + 2] = this.color[j * 4 + 2]
      color[j * 4 + 3] = this.color[j * 4 + 3] * Math.min(1, f * 12) * (1 - f) ** 1.3
      rot[j] = this.rot[j * 2]
    }
    this.geometry.instanceCount = this.count
    for (const a of [this.iPos, this.iSize, this.iColor, this.iRot]) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, this.count * a.itemSize)
      a.needsUpdate = true
    }
  }

  private moveLastTo(i: number): void {
    const last = --this.count
    if (i === last) return
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.age[i] = this.age[last]
    this.life[i] = this.life[last]
    this.size.copyWithin(i * 2, last * 2, last * 2 + 2)
    this.color.copyWithin(i * 4, last * 4, last * 4 + 4)
    this.physics.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.rot.copyWithin(i * 2, last * 2, last * 2 + 2)
  }
}

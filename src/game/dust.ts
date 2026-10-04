import * as THREE from 'three'

type Particle = {
  life: number
  maxLife: number
  velocity: THREE.Vector3
}

export class DustSystem {
  readonly points: THREE.Points
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly particles: Particle[]
  private readonly capacity: number
  private cursor = 0

  constructor(capacity = 400) {
    this.capacity = capacity
    this.positions = new Float32Array(capacity * 3)
    this.colors = new Float32Array(capacity * 3)
    this.particles = Array.from({ length: capacity }, () => ({
      life: 0,
      maxLife: 1,
      velocity: new THREE.Vector3(),
    }))

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))

    const mat = new THREE.PointsMaterial({
      size: 0.55,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      sizeAttenuation: true,
    })

    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
  }

  emit(origin: THREE.Vector3, heading: number, speed: number, slip: number, dt: number): void {
    const rate = (Math.abs(speed) * 0.35 + slip * 2.5) * dt * 60
    const count = Math.min(8, Math.floor(rate))
    if (count <= 0 || Math.abs(speed) < 2) return

    const back = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading))
    const right = new THREE.Vector3(back.z, 0, -back.x)

    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor]
      p.maxLife = 0.45 + Math.random() * 0.55
      p.life = p.maxLife

      const side = (Math.random() - 0.5) * 1.4
      const ox = origin.x + back.x * 1.2 + right.x * side
      const oy = origin.y - 0.15 + Math.random() * 0.2
      const oz = origin.z + back.z * 1.2 + right.z * side

      this.positions[this.cursor * 3] = ox
      this.positions[this.cursor * 3 + 1] = oy
      this.positions[this.cursor * 3 + 2] = oz

      p.velocity.set(
        back.x * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2,
        1.2 + Math.random() * 2,
        back.z * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2,
      )

      const warm = 0.75 + Math.random() * 0.2
      this.colors[this.cursor * 3] = warm
      this.colors[this.cursor * 3 + 1] = warm * 0.75
      this.colors[this.cursor * 3 + 2] = warm * 0.45

      this.cursor = (this.cursor + 1) % this.capacity
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i]
      if (p.life <= 0) {
        this.positions[i * 3 + 1] = -999
        continue
      }
      p.life -= dt
      this.positions[i * 3] += p.velocity.x * dt
      this.positions[i * 3 + 1] += p.velocity.y * dt
      this.positions[i * 3 + 2] += p.velocity.z * dt
      p.velocity.y -= 4 * dt
      p.velocity.multiplyScalar(1 - 1.5 * dt)

      const fade = Math.max(0, p.life / p.maxLife)
      this.colors[i * 3 + 0] *= 0.98
      this.colors[i * 3 + 1] *= 0.98
      this.colors[i * 3 + 2] *= 0.98
      if (fade < 0.01) p.life = 0
    }

    const posAttr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const colAttr = this.points.geometry.getAttribute('color') as THREE.BufferAttribute
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
  }
}

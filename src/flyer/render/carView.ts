import * as THREE from 'three'
import { GROUND_Y } from '../sim/config'
import type { SimEvent, SimState } from '../sim/types'
import type { Materials } from './kit'
import type { Particles } from './particles'
import type { Shadows } from './props'
import { createRoadster, poseRoadster, WHEEL_RADIUS, type Roadster } from './roadster'

const JET_LENGTH = 3.2

const jetVertex = /* glsl */ `
  varying float vT;
  varying float vRim;
  void main() {
    vT = -position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vRim = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`
const jetFragment = /* glsl */ `
  uniform float uPower;
  uniform float uTime;
  varying float vT;
  varying float vRim;
  void main() {
    float flicker = 0.85 + 0.15 * sin(uTime * 61.0 + vT * 9.0);
    float a = pow(max(0.0, 1.0 - vT), 1.7) * pow(vRim, 1.4) * uPower * flicker;
    vec3 c = mix(vec3(3.0, 3.4, 3.8), vec3(0.35, 1.3, 2.6), smoothstep(0.0, 0.45, vT));
    gl_FragColor = vec4(c * a, a);
  }
`

function poolTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(canvas)
}

/**
 * The player's roadster with its four hub jets, headlights, jet-wash glow on the road and all of
 * its smoke: exhaust trails, the ground billow when the jets hit the road (tinted red behind the
 * car by its tail lights), take-off and landing clouds, and crash sparks.
 */
export class CarView {
  readonly car: Roadster
  private readonly jets: THREE.Mesh[] = []
  private readonly jetMaterial: THREE.ShaderMaterial
  private readonly washPool: THREE.Mesh
  private flight = 0
  private pitch = 0
  private wheelSpin = 0
  private emitCarry = 0
  private washCarry = 0
  private sparkCarry = 0
  private smokeCarry = 0
  private readonly tmp = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()
  private readonly smoke: Particles
  private readonly sparks: Particles

  constructor(scene: THREE.Scene, materials: Materials, smoke: Particles, sparks: Particles) {
    this.smoke = smoke
    this.sparks = sparks
    this.car = createRoadster(materials)
    scene.add(this.car.root)

    this.jetMaterial = new THREE.ShaderMaterial({
      uniforms: { uPower: { value: 0 }, uTime: { value: 0 } },
      vertexShader: jetVertex,
      fragmentShader: jetFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const cone = new THREE.CylinderGeometry(0.1, 0.36, 1, 18, 1, true)
    cone.translate(0, -0.5, 0)
    for (const n of this.car.nozzles) {
      const jet = new THREE.Mesh(cone, this.jetMaterial)
      jet.position.copy(n)
      jet.renderOrder = 5
      jet.frustumCulled = false
      this.car.body.add(jet)
      this.jets.push(jet)
    }

    const headlight = new THREE.SpotLight(0xf2f6ff, 260, 70, 0.42, 0.55, 1.6)
    headlight.position.set(2.0, 0, 0)
    headlight.target.position.set(22, -2.2, 0)
    this.car.body.add(headlight, headlight.target)

    const poolGeometry = new THREE.PlaneGeometry(1, 1)
    poolGeometry.rotateX(-Math.PI / 2)
    this.washPool = new THREE.Mesh(
      poolGeometry,
      new THREE.MeshBasicMaterial({
        map: poolTexture(),
        color: new THREE.Color(0.25, 0.75, 1.3),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    )
    this.washPool.renderOrder = 1
    scene.add(this.washPool)
  }

  reset(): void {
    this.flight = 0
    this.pitch = 0
  }

  update(s: SimState, dt: number, shadows: Shadows): void {
    const c = s.car
    const crashed = !!c.crash
    const jet = crashed ? 0 : Math.max(c.spool, c.flare ? 0.85 : 0)
    const airborne = !c.grounded && !crashed
    this.flight += ((airborne || c.spool > 0.2 ? 1 : 0) - this.flight) * Math.min(1, dt * 7)
    this.pitch += (c.pitch - this.pitch) * Math.min(1, dt * (crashed ? 60 : 12))
    this.wheelSpin += (c.vx / WHEEL_RADIUS) * dt * (1 - this.flight)

    const root = this.car.root
    root.position.set(c.x, c.y, 0)
    poseRoadster(this.car, crashed ? 0 : this.flight, crashed ? c.pitch : this.pitch, c.roll, this.wheelSpin, jet)
    root.updateMatrixWorld(true)

    this.jetMaterial.uniforms.uPower.value = jet
    this.jetMaterial.uniforms.uTime.value = s.t
    for (const j of this.jets) {
      j.visible = jet > 0.02
      j.scale.set(1, JET_LENGTH * (0.35 + 0.65 * jet) * (0.92 + Math.random() * 0.16), 1)
    }

    const height = c.y - GROUND_Y
    shadows.add(c.x, height, 4.8, 2.2, crashed ? 0.6 : 0.85)

    // Jet direction in world space (body down).
    this.car.body.getWorldQuaternion(this.quat)
    this.dir.set(0, -1, 0).applyQuaternion(this.quat)
    const downward = Math.max(0, -this.dir.y)
    const washStrength = jet * downward * Math.max(0, 1 - height / 7)
    this.washPool.position.set(c.x, 0.04, 0)
    this.washPool.scale.setScalar(5 + height * 1.2)
    ;(this.washPool.material as THREE.MeshBasicMaterial).opacity = washStrength * 0.9
    this.washPool.visible = washStrength > 0.01

    if (jet > 0.02) this.emitJets(c.vx, c.vy, jet, dt)
    if (washStrength > 0.02) this.emitWash(c.x, c.vx, washStrength, dt)
    if (crashed) this.emitCrash(s, dt)
  }

  private emitJets(vx: number, vy: number, jet: number, dt: number): void {
    this.emitCarry += dt * 34 * jet * this.jets.length
    while (this.emitCarry >= 1) {
      this.emitCarry -= 1
      const n = this.car.nozzles[Math.floor(Math.random() * this.car.nozzles.length)]
      this.tmp.copy(n).applyMatrix4(this.car.body.matrixWorld)
      const along = 0.4 + Math.random() * 1.6
      const speed = 11 + Math.random() * 6
      this.smoke.emit(
        this.tmp.x + this.dir.x * along,
        this.tmp.y + this.dir.y * along,
        this.tmp.z + this.dir.z * along,
        vx * 0.55 + this.dir.x * speed + (Math.random() - 0.5) * 2,
        vy * 0.4 + this.dir.y * speed,
        this.dir.z * speed + (Math.random() - 0.5) * 2,
        { life: 0.65, size0: 0.35, size1: 2.1, color: [0.62, 0.78, 0.92], alpha: 0.32, drag: 3.2, rise: 1.5, spin: 1.2 },
      )
    }
  }

  /** Smoke blasting sideways off the road when the jets are close to it. */
  private emitWash(carX: number, vx: number, strength: number, dt: number): void {
    this.washCarry += dt * 90 * strength
    while (this.washCarry >= 1) {
      this.washCarry -= 1
      this.groundPuff(carX + (Math.random() - 0.5) * 3.6, vx, 1, carX)
    }
  }

  /** A billow of smoke along the road; puffs behind the car pick up the red of its tail lights. */
  private groundPuff(x: number, carVx: number, power: number, carX: number): void {
    const side = Math.random() < 0.5 ? -1 : 1
    const behind = x < carX - 0.6
    const red = behind ? 0.45 + Math.random() * 0.3 : Math.random() * 0.15
    const grey = 0.42 + Math.random() * 0.14
    this.smoke.emit(
      x,
      0.4,
      (Math.random() - 0.5) * 1.6,
      carVx * 0.25 + (Math.random() - 0.65) * 6 * power,
      0.6 + Math.random() * 1.8 * power,
      side * (3 + Math.random() * 8) * power,
      {
        life: 1.7,
        size0: 1.0,
        size1: 4.8 + power,
        color: [grey + red * 0.45, grey * (1 - red * 0.55), grey * (1 - red * 0.5) + 0.04],
        alpha: 0.34,
        drag: 1.5,
        rise: 0.7,
        spin: 0.5,
      },
    )
  }

  /** One-shot clouds and sparks for sim events. */
  handleEvent(e: SimEvent, s: SimState): void {
    const { sparks } = this
    const c = s.car
    switch (e.type) {
      case 'takeoff':
        for (let i = 0; i < 22; i++) this.groundPuff(c.x + (Math.random() - 0.5) * 4, c.vx, 1.1, c.x)
        break
      case 'land': {
        const power = Math.min(1.8, 0.6 + e.impact / 10)
        for (let i = 0; i < 14 + e.impact * 2.5; i++) this.groundPuff(c.x + (Math.random() - 0.5) * 4.4, c.vx, power, c.x)
        break
      }
      case 'crash':
      case 'bounce':
        for (let i = 0; i < 40; i++) {
          sparks.emit(c.x + (Math.random() - 0.5) * 3, c.y, (Math.random() - 0.5) * 2, c.vx * 0.5 + (Math.random() - 0.5) * 16, Math.random() * 12, (Math.random() - 0.5) * 14, {
            life: 0.5,
            size0: 0.35,
            size1: 0.05,
            color: [4, 1.6, 0.4],
            alpha: 1,
            drag: 1.2,
            rise: -22,
          })
        }
        for (let i = 0; i < 12; i++) this.groundPuff(c.x + (Math.random() - 0.5) * 4, c.vx, 1.3, c.x + 10)
        break
      case 'cell':
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2
          sparks.emit(e.x, e.y, 0, Math.cos(a) * 6 + c.vx * 0.6, Math.sin(a) * 6, (Math.random() - 0.5) * 4, {
            life: 0.35,
            size0: 0.5,
            size1: 0.1,
            color: [0.6, 3, 1.8],
            alpha: 1,
            drag: 4,
          })
        }
        break
      default:
        break
    }
  }

  private emitCrash(s: SimState, dt: number): void {
    const { smoke, sparks } = this
    const c = s.car
    const crash = c.crash!
    this.smokeCarry += dt * 26
    while (this.smokeCarry >= 1) {
      this.smokeCarry -= 1
      const v = 0.08 + Math.random() * 0.06
      smoke.emit(c.x + (Math.random() - 0.5) * 2, c.y + 0.4, (Math.random() - 0.5), c.vx * 0.3, 1.5, (Math.random() - 0.5) * 1.5, {
        life: 2.2,
        size0: 0.8,
        size1: 4.5,
        color: [v, v, v * 1.05],
        alpha: 0.5,
        drag: 0.6,
        rise: 1.8,
      })
    }
    if (crash.grounded && crash.vx > 1) {
      this.sparkCarry += dt * 90 * Math.min(1, crash.vx / 15)
      while (this.sparkCarry >= 1) {
        this.sparkCarry -= 1
        sparks.emit(c.x - 1.5 + Math.random() * 3, 0.15, (Math.random() - 0.5) * 1.8, crash.vx * (0.2 + Math.random() * 0.6), 1 + Math.random() * 6, (Math.random() - 0.5) * 9, {
          life: 0.4,
          size0: 0.28,
          size1: 0.04,
          color: [4, 1.5, 0.35],
          alpha: 1,
          drag: 1,
          rise: -20,
        })
      }
    }
  }
}

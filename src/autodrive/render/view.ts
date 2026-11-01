import * as THREE from 'three'
import { Particles } from '../../flyer/render/particles'
import { ROAD_EDGE } from '../sim/config'
import type { Autopilot } from '../sim/fsd/autopilot'
import { isChasing } from '../sim/police'
import type { RoadPoint } from '../sim/road'
import type { Agent, SimEvent, SimState } from '../sim/types'
import { CameraRig } from './camera'
import { CarPool, CarView, createCarShared } from './cars'
import { Environment } from './env'
import { Backdrop, Ocean } from './ocean'
import { Overlay } from './overlay'
import { Post } from './post'
import { WorldView } from './world'

export type Tier = 'low' | 'high'

export function detectTier(): Tier {
  const q = new URLSearchParams(window.location.search).get('quality')
  if (q === 'low' || q === 'high') return q
  return window.matchMedia('(pointer: coarse)').matches ? 'low' : 'high'
}

const WHITE = new THREE.Color(1, 1, 1)
const RED = new THREE.Color(1, 0.2, 0.15)

/** Everything that draws. */
export class View {
  readonly renderer: THREE.WebGLRenderer
  readonly rig = new CameraRig()
  readonly overlay: Overlay
  private readonly scene = new THREE.Scene()
  private readonly env: Environment
  private world: WorldView | null = null
  private readonly ocean: Ocean
  private readonly backdrop: Backdrop
  private readonly post: Post
  private readonly pool: CarPool
  private readonly egoView: CarView
  private readonly views = new Map<number, CarView>()
  private readonly smoke: Particles
  private readonly sparks: Particles
  private readonly copLights: THREE.PointLight[] = []
  private readonly spikeMeshes = new Map<number, THREE.Mesh>()
  private readonly camMeshes = new Map<number, THREE.Group>()
  private readonly spikeGeo: THREE.BufferGeometry
  private readonly spikeMat: THREE.MeshStandardMaterial
  private readonly camGeo: THREE.BufferGeometry
  private readonly camMat: THREE.MeshStandardMaterial
  private readonly underglow: THREE.Mesh
  private readonly pt: RoadPoint = { x: 0, y: 0, z: 0, psi: 0, kappa: 0 }
  private readonly tier: Tier
  private time = 0
  private roadId: unknown = null

  constructor(canvas: HTMLCanvasElement, tier: Tier) {
    this.tier = tier
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'high' ? 1.75 : 1.25))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    const noShadows = new URLSearchParams(window.location.search).get('shadows') === '0'
    this.env = new Environment(this.scene, this.renderer, noShadows ? 0 : tier === 'high' ? 2048 : 1024)
    this.ocean = new Ocean(this.scene)
    this.backdrop = new Backdrop(this.scene)
    this.overlay = new Overlay(this.scene)
    const shared = createCarShared()
    this.pool = new CarPool(this.scene, shared, true)
    this.egoView = new CarView('ego', 0, shared, true)
    this.scene.add(this.egoView.group)
    this.smoke = new Particles(tier === 'high' ? 900 : 450, 'smoke')
    this.sparks = new Particles(500, 'glow')
    this.scene.add(this.smoke.mesh, this.sparks.mesh)
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xff0000, 0, 22, 1.6)
      this.copLights.push(l)
      this.scene.add(l)
    }

    // Spike strip: a flat dark band with a row of teeth.
    const strip: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.5, 0.05, 1).translate(0, 0.025, 0).toNonIndexed()]
    for (let i = 0; i < 14; i++) strip.push(new THREE.ConeGeometry(0.04, 0.14, 4).translate(0, 0.1, -0.5 + (i + 0.5) / 14).toNonIndexed())
    this.spikeGeo = mergeSimple(strip)
    this.spikeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.08, 0.09), metalness: 0.8, roughness: 0.35 })
    // Speed camera on a pole.
    this.camGeo = mergeSimple([
      new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8).translate(0, 2.1, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.5, 0.42, 0.5).translate(0, 4.3, 0).toNonIndexed(),
    ])
    this.camMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.5, 0.2), metalness: 0.4, roughness: 0.5 })

    const glow = document.createElement('canvas')
    glow.width = glow.height = 64
    const gctx = glow.getContext('2d')!
    const grad = gctx.createRadialGradient(32, 32, 2, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    gctx.fillStyle = grad
    gctx.fillRect(0, 0, 64, 64)
    this.underglow = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 3.0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glow), color: new THREE.Color(0.15, 0.5, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.underglow.renderOrder = 4
    this.egoView.group.add(this.underglow)
    this.underglow.position.y = 0.04

    this.post = new Post(this.renderer, this.scene, this.rig.camera, tier === 'high')
    this.resize()
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.post.setSize(w, h)
    this.rig.resize(w, h)
  }

  /** Drop every per-run object (new sim). */
  reset(sim: SimState): void {
    for (const v of this.views.values()) this.pool.give(v)
    this.views.clear()
    for (const m of this.spikeMeshes.values()) this.scene.remove(m)
    this.spikeMeshes.clear()
    for (const m of this.camMeshes.values()) this.scene.remove(m)
    this.camMeshes.clear()
    this.smoke.clear()
    this.sparks.clear()
    if (this.roadId !== sim.road) {
      this.world?.reset()
      this.world = new WorldView(this.scene, sim.road, this.tier)
      this.roadId = sim.road
    }
    this.rig.cut()
  }

  handleEvents(events: readonly SimEvent[], sim: SimState): void {
    const e = sim.ego
    const p = sim.road.point(e.s, e.d, this.pt)
    for (const ev of events) {
      switch (ev.type) {
        case 'collision': {
          this.rig.shake(Math.min(0.9, ev.impact / 14))
          this.burst(sim, ev.id, Math.min(60, 8 + ev.impact * 4))
          if (ev.impact > 6) this.post.pulse(0.18, WHITE)
          break
        }
        case 'barrier': {
          this.rig.shake(Math.min(0.5, ev.impact / 8))
          const lx = -Math.sin(p.psi) * ev.side
          const lz = -Math.cos(p.psi) * ev.side
          for (let i = 0; i < 18; i++) this.spark(p.x + lx, p.y + 0.4, p.z + lz, e.v)
          break
        }
        case 'speedcam':
          this.post.pulse(0.55, WHITE)
          break
        case 'spiked':
          this.rig.shake(0.6)
          for (let i = 0; i < 30; i++) this.spark(p.x, p.y + 0.2, p.z, e.v)
          break
        case 'busted':
          this.post.pulse(0.35, RED)
          break
        case 'wrecked':
          this.rig.shake(1)
          this.post.pulse(0.4, WHITE)
          break
        case 'copWrecked':
        case 'agentCrash':
          this.burst(sim, ev.id, 30)
          break
        default:
          break
      }
    }
  }

  private spark(x: number, y: number, z: number, v: number): void {
    const a = Math.random() * Math.PI * 2
    const sp = 3 + Math.random() * 8
    this.sparks.emit(x, y, z, Math.cos(a) * sp + v * 0.6, 1 + Math.random() * 4, Math.sin(a) * sp, {
      life: 0.45,
      size0: 0.12,
      size1: 0.02,
      color: [6, 3.2, 1.2],
      alpha: 1,
      drag: 1.5,
      rise: -9,
    })
  }

  private burst(sim: SimState, id: number, count: number): void {
    const a = sim.agents.find((x) => x.id === id)
    const e = sim.ego
    const s = a ? (a.s + e.s) / 2 : e.s
    const d = a ? (a.d + e.d) / 2 : e.d
    const p = sim.road.point(s, d, this.pt)
    const fx = Math.cos(p.psi)
    const fz = -Math.sin(p.psi)
    for (let i = 0; i < count; i++) this.spark(p.x, p.y + 0.5, p.z, 0)
    for (let i = 0; i < count / 3; i++) {
      this.smoke.emit(p.x + (Math.random() - 0.5), p.y + 0.4, p.z + (Math.random() - 0.5), fx * e.v * 0.5, 1, fz * e.v * 0.5, {
        life: 1.6,
        size0: 1.2,
        size1: 4.5,
        color: [0.5, 0.48, 0.46],
        alpha: 0.5,
        drag: 1.2,
        rise: 0.6,
      })
    }
  }

  private placeAgent(sim: SimState, a: Agent, view: CarView, dt: number, siren: boolean): void {
    const p = sim.road.point(a.s, a.d, this.pt)
    const grade = sim.road.grade(a.s)
    const yaw = p.psi + (a.dir > 0 ? a.psi : Math.PI - a.psi)
    const pitch = Math.atan(grade) * a.dir
    const roll = a.wrecked >= 0 ? Math.sin(Math.min(1, a.wrecked) * Math.PI) * 0.08 * Math.sign(a.spin) : -a.vd * 0.012
    view.update(p.x, p.y, p.z, yaw, pitch, roll, a.v, dt, 0, a.accel < -1.2 || (a.role !== 'oncoming' && a.v < 1), a.signal * a.dir, this.time + a.id * 0.13, siren)
  }

  frame(sim: SimState, ap: Autopilot, dt: number): void {
    this.time += dt
    const e = sim.ego
    const road = sim.road
    const p = road.point(e.s, e.d, this.pt)
    const px = p.x
    const py = p.y
    const pz = p.z
    const yaw = p.psi + e.psi
    const pitch = Math.atan(road.grade(e.s))

    // Hero car.
    this.egoView.update(px, py, pz, yaw, pitch, -e.latAccel * 0.006 + (e.tiresBlown ? Math.sin(this.time * 9) * 0.01 : 0), e.v, dt, e.steer * 1.6, e.braking, e.signal, this.time, false)
    const glow = this.underglow.material as THREE.MeshBasicMaterial
    glow.opacity += ((ap.engaged ? (ap.status.takeover ? 0.3 : 0.14) : 0) - glow.opacity) * Math.min(1, dt * 5)
    glow.color.setRGB(ap.status.takeover ? 1.6 : 0.15, ap.status.takeover ? 0.15 : 0.5, ap.status.takeover ? 0.15 : 1.6)
    this.underglow.visible = glow.opacity > 0.01

    // Agents.
    const seen = new Set<number>()
    const chasers: { a: Agent; dist: number }[] = []
    for (const a of sim.agents) {
      const ds = a.s - e.s
      if (ds > 1150 || ds < -260) continue
      seen.add(a.id)
      let view = this.views.get(a.id)
      if (!view) {
        view = this.pool.take(a.kind, a.color)
        this.views.set(a.id, view)
      }
      const siren = (a.role === 'cop' && (isChasing(a) || a.copState === 'retreat')) || a.role === 'block'
      this.placeAgent(sim, a, view, dt, siren && a.wrecked < 0)
      if (siren && a.wrecked < 0) chasers.push({ a, dist: Math.hypot(ds, a.d - e.d) })
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue
      this.pool.give(v)
      this.views.delete(id)
    }
    chasers.sort((x, y) => x.dist - y.dist)
    const phase = Math.floor(this.time * 7) % 2
    this.copLights.forEach((l, i) => {
      const c = chasers[i]
      if (!c || c.dist > 90) {
        l.intensity = 0
        return
      }
      const q = road.point(c.a.s, c.a.d)
      l.position.set(q.x, q.y + 2.2, q.z)
      l.color.set((phase + i) % 2 ? 0xff2020 : 0x2050ff)
      l.intensity = 60
    })

    // Hazards and speed cameras.
    const keepSpikes = new Set<number>()
    for (const k of sim.spikes) {
      keepSpikes.add(k.id)
      let m = this.spikeMeshes.get(k.id)
      if (!m) {
        m = new THREE.Mesh(this.spikeGeo, this.spikeMat)
        m.castShadow = true
        this.scene.add(m)
        this.spikeMeshes.set(k.id, m)
      }
      const q = road.point(k.s, (k.d0 + k.d1) / 2)
      m.position.set(q.x, q.y, q.z)
      m.rotation.set(0, q.psi, 0)
      m.scale.set(1, 1, Math.min(1, k.age / 0.6) * (k.d1 - k.d0))
    }
    for (const [id, m] of this.spikeMeshes) {
      if (keepSpikes.has(id)) continue
      this.scene.remove(m)
      this.spikeMeshes.delete(id)
    }
    const keepCams = new Set<number>()
    for (const c of sim.cams) {
      const key = Math.round(c.s)
      keepCams.add(key)
      if (this.camMeshes.has(key)) continue
      const g = new THREE.Group()
      const m = new THREE.Mesh(this.camGeo, this.camMat)
      m.castShadow = true
      g.add(m)
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1) }))
      lens.position.set(-0.26, 4.32, 0)
      lens.rotation.y = -Math.PI / 2
      g.add(lens)
      const q = road.point(c.s, -(ROAD_EDGE + 1.6))
      g.position.set(q.x, q.y, q.z)
      g.rotation.y = q.psi
      this.scene.add(g)
      this.camMeshes.set(key, g)
    }
    for (const [key, g] of this.camMeshes) {
      if (keepCams.has(key)) continue
      this.scene.remove(g)
      this.camMeshes.delete(key)
    }

    // Tyre smoke when the tyres are past the limit or blown.
    const fx = Math.cos(yaw)
    const fz = -Math.sin(yaw)
    const lx = -Math.sin(yaw)
    const lz = -Math.cos(yaw)
    const slip = Math.max(e.slip, e.tiresBlown && e.v > 3 ? 0.5 : 0)
    if (slip > 0.15 && e.v > 3) {
      const n = Math.ceil(slip * 3)
      for (let i = 0; i < n; i++) {
        for (const side of [-1, 1]) {
          const bx = px - fx * 1.5 + lx * side * 0.85
          const bz = pz - fz * 1.5 + lz * side * 0.85
          this.smoke.emit(bx, py + 0.25, bz, fx * e.v * 0.25 + (Math.random() - 0.5), 0.6, fz * e.v * 0.25 + (Math.random() - 0.5), {
            life: 1.4,
            size0: 0.6,
            size1: 3.4,
            color: [0.78, 0.76, 0.74],
            alpha: 0.32 * slip,
            drag: 1.8,
            rise: 0.5,
          })
        }
      }
      if (e.tiresBlown && Math.random() < 0.5) this.spark(px - fx * 1.4, py + 0.1, pz - fz * 1.4, e.v * 0.8)
    }

    this.overlay.update(sim, ap, this.time)
    this.rig.update(px, py, pz, yaw, pitch, e.v, e.latAccel, dt)
    const cam = this.rig.camera
    this.env.follow(px + fx * 20, py, pz + fz * 20, cam)
    this.ocean.update(cam, this.time)
    this.backdrop.update(cam)
    this.world?.update(e.s)
    this.smoke.update(dt)
    this.sparks.update(dt)
    this.post.render(e.v, dt)
  }

  /** Screen position of a world point (CSS px), or null when behind the camera. */
  project(sim: SimState, s: number, d: number, height: number): { x: number; y: number } | null {
    const p = sim.road.point(s, d)
    const v = new THREE.Vector3(p.x, p.y + height, p.z).project(this.rig.camera)
    if (v.z > 1) return null
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight }
  }
}

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0
  for (const g of list) count += g.attributes.position.count
  const pos = new Float32Array(count * 3)
  let o = 0
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3)
    o += g.attributes.position.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.computeVertexNormals()
  return out
}

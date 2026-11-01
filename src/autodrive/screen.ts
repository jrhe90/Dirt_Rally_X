import { LANE_WIDTH, LANES, MEDIAN_HALF, ROAD_EDGE } from './sim/config'
import type { Autopilot } from './sim/fsd/autopilot'
import type { Track } from './sim/fsd/perception'
import { PLAN_STEPS, sampleTrajectory } from './sim/fsd/planner'
import type { RoadPoint } from './sim/road'
import type { SimState } from './sim/types'

/**
 * The centre-screen visualization: what the car sees and intends, drawn from a virtual camera
 * behind and above it. Lane lines bend with the real road, every tracked object is a shaded
 * box (the vehicle being followed in blue, police with flashing bars, hazards in orange), and
 * the planned path is a blue band that turns red when the driver must take over.
 */

type P2 = { x: number; y: number; depth: number }

const CAM_BACK = 13
const CAM_UP = 9.5
const PITCH = 0.36

export class AutopilotScreen {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private dpr = 1
  private egoX = 0
  private egoZ = 0
  private egoY = 0
  private cosY = 1
  private sinY = 0
  private readonly pt: RoadPoint = { x: 0, y: 0, z: 0, psi: 0, kappa: 0 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (r.width * dpr !== this.w || r.height * dpr !== this.h) {
      this.w = Math.max(1, Math.round(r.width * dpr))
      this.h = Math.max(1, Math.round(r.height * dpr))
      this.dpr = dpr
      this.canvas.width = this.w
      this.canvas.height = this.h
    }
  }

  /** Ego-frame coordinates (forward, left) of road point (s, d). */
  private local(sim: SimState, s: number, d: number): [number, number, number] {
    const p = sim.road.point(s, d, this.pt)
    const dx = p.x - this.egoX
    const dz = p.z - this.egoZ
    // Forward is (cos, -sin) in (x, z); left is (-sin, -cos).
    const f = dx * this.cosY - dz * this.sinY
    const l = -dx * this.sinY - dz * this.cosY
    return [f, l, p.y - this.egoY]
  }

  private project(f: number, l: number, h: number): P2 | null {
    const Z = f + CAM_BACK
    const Y = h - CAM_UP
    const c = Math.cos(PITCH)
    const s = Math.sin(PITCH)
    const depth = Z * c - Y * s
    if (depth < 1.5) return null
    const vert = Z * s + Y * c
    const F = this.h * 1.25
    return { x: this.w / 2 - (F * l) / depth, y: this.h * 0.44 - (F * vert) / depth, depth }
  }

  draw(sim: SimState, ap: Autopilot): void {
    this.resize()
    const { ctx, w, h } = this
    const e = sim.ego
    const p = sim.road.point(e.s, e.d, this.pt)
    this.egoX = p.x
    this.egoZ = p.z
    this.egoY = p.y
    const yaw = p.psi + e.psi
    this.cosY = Math.cos(yaw)
    this.sinY = Math.sin(yaw)

    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#0b0d11')
    bg.addColorStop(1, '#1b1f26')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    // Road surface (our carriageway) as a slightly lighter band.
    const band = (d0: number, d1: number, color: string) => {
      const left: P2[] = []
      const right: P2[] = []
      for (let ds = -16; ds <= 150; ds += 6) {
        const a = this.project(...this.local(sim, e.s + ds, d0))
        const b = this.project(...this.local(sim, e.s + ds, d1))
        if (a && b) {
          left.push(a)
          right.push(b)
        }
      }
      if (left.length < 2) return
      ctx.beginPath()
      left.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
    }
    band(-ROAD_EDGE, -0.3, 'rgba(70,78,92,0.35)')
    band(0.3, ROAD_EDGE, 'rgba(70,78,92,0.16)')

    // Lane lines.
    const line = (d: number, dashed: boolean, color: string, width: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width * this.dpr
      ctx.beginPath()
      let pen = false
      for (let ds = -16; ds <= 150; ds += 3) {
        const q = this.project(...this.local(sim, e.s + ds, d))
        const dashOn = !dashed || Math.floor((e.s + ds) / 6) % 2 === 0
        if (!q || !dashOn) {
          pen = false
          continue
        }
        if (pen) ctx.lineTo(q.x, q.y)
        else ctx.moveTo(q.x, q.y)
        pen = true
      }
      ctx.stroke()
    }
    line(-MEDIAN_HALF + 0.1, false, 'rgba(226,178,58,0.75)', 1.6)
    for (let k = 1; k < LANES; k++) line(-(MEDIAN_HALF + LANE_WIDTH * k), true, 'rgba(230,236,245,0.6)', 1.4)
    line(-(MEDIAN_HALF + LANE_WIDTH * LANES), false, 'rgba(230,236,245,0.65)', 1.6)
    line(0, false, 'rgba(150,160,175,0.5)', 2.4)
    for (let k = 1; k < LANES; k++) line(MEDIAN_HALF + LANE_WIDTH * k, true, 'rgba(230,236,245,0.22)', 1.1)
    line(MEDIAN_HALF + LANE_WIDTH * LANES, false, 'rgba(230,236,245,0.25)', 1.2)

    // Planned path.
    if (ap.engaged && ap.plan) {
      const tr = ap.plan
      const tau0 = sim.t - tr.t0
      const horizon = (PLAN_STEPS - 1) * 0.2
      const left: P2[] = []
      const right: P2[] = []
      for (let i = 0; i <= 30; i++) {
        const tau = tau0 + ((horizon - tau0) * i) / 30
        const s = i === 0 ? e.s : sampleTrajectory(tr, tau, 's')
        const d = i === 0 ? e.d : sampleTrajectory(tr, tau, 'd')
        const a = this.project(...this.local(sim, s, d + 0.8))
        const b = this.project(...this.local(sim, s, d - 0.8))
        if (a && b) {
          left.push(a)
          right.push(b)
        }
      }
      if (left.length > 1) {
        const takeover = ap.status.takeover
        const g = ctx.createLinearGradient(0, left[0].y, 0, left[left.length - 1].y)
        g.addColorStop(0, takeover ? 'rgba(255,60,50,0.75)' : 'rgba(50,140,255,0.8)')
        g.addColorStop(1, takeover ? 'rgba(255,60,50,0)' : 'rgba(50,140,255,0)')
        ctx.beginPath()
        left.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
        for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y)
        ctx.closePath()
        ctx.fillStyle = g
        ctx.fill()
      }
    }

    // Spike strips.
    for (const k of ap.perception.spikes) {
      const pts = [
        this.project(...this.local(sim, k.s - 0.6, k.d0)),
        this.project(...this.local(sim, k.s - 0.6, k.d1)),
        this.project(...this.local(sim, k.s + 0.6, k.d1)),
        this.project(...this.local(sim, k.s + 0.6, k.d0)),
      ]
      if (pts.some((q) => !q)) continue
      ctx.beginPath()
      pts.forEach((q, i) => (i ? ctx.lineTo(q!.x, q!.y) : ctx.moveTo(q!.x, q!.y)))
      ctx.closePath()
      ctx.fillStyle = Math.floor(sim.t * 4) % 2 ? 'rgba(255,150,30,0.9)' : 'rgba(255,90,20,0.9)'
      ctx.fill()
    }

    // Vehicles, far to near.
    const tracks = [...ap.perception.tracks.values()].filter((t) => t.s - e.s < 150 && t.s - e.s > -18)
    tracks.sort((a, b) => b.s - a.s)
    const flash = Math.floor(sim.t * 6) % 2 === 0
    for (const t of tracks) this.vehicle(sim, t, ap, flash)
    this.egoCar(ap)
  }

  private box(corners: [number, number, number][], height: number, top: string, side: string, edge: string | null): void {
    const { ctx } = this
    const base = corners.map((c) => this.project(c[0], c[1], c[2]))
    const roof = corners.map((c) => this.project(c[0], c[1], c[2] + height))
    if (base.some((q) => !q) || roof.some((q) => !q)) return
    const b = base as P2[]
    const r = roof as P2[]
    ctx.fillStyle = side
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      ctx.beginPath()
      ctx.moveTo(b[i].x, b[i].y)
      ctx.lineTo(b[j].x, b[j].y)
      ctx.lineTo(r[j].x, r[j].y)
      ctx.lineTo(r[i].x, r[i].y)
      ctx.closePath()
      ctx.fill()
    }
    ctx.beginPath()
    r.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
    ctx.closePath()
    ctx.fillStyle = top
    ctx.fill()
    if (edge) {
      ctx.strokeStyle = edge
      ctx.lineWidth = 1.5 * this.dpr
      ctx.stroke()
    }
  }

  private footprint(sim: SimState, s: number, d: number, psi: number, length: number, width: number): [number, number, number][] {
    const [f, l, y] = this.local(sim, s, d)
    // Road heading relative to ego in the display frame.
    const q = sim.road.point(s, d, this.pt)
    const rel = q.psi + psi - Math.atan2(this.sinY, this.cosY)
    const c = Math.cos(rel)
    const sn = Math.sin(rel)
    const hl = length / 2
    const hw = width / 2
    return [
      [f + c * hl - sn * hw, l + sn * hl + c * hw, y],
      [f + c * hl + sn * hw, l + sn * hl - c * hw, y],
      [f - c * hl + sn * hw, l - sn * hl - c * hw, y],
      [f - c * hl - sn * hw, l - sn * hl + c * hw, y],
    ]
  }

  private vehicle(sim: SimState, t: Track, ap: Autopilot, flash: boolean): void {
    const corners = this.footprint(sim, t.s, t.d, t.kind === 'oncoming' ? Math.PI : t.psi, t.length, t.width)
    const height = Math.min(2.2, t.height * 0.8)
    const lead = ap.engaged && t.id === ap.status.leadId
    const alpha = t.visible ? 1 : 0.45
    let top = `rgba(170,178,190,${0.92 * alpha})`
    let side = `rgba(92,100,112,${0.92 * alpha})`
    let edge: string | null = null
    if (t.kind === 'oncoming') {
      top = 'rgba(110,116,126,0.45)'
      side = 'rgba(70,76,86,0.45)'
    } else if (t.kind === 'police') {
      top = 'rgba(200,205,215,0.95)'
      side = 'rgba(40,44,52,0.95)'
      edge = flash ? 'rgba(255,60,60,0.95)' : 'rgba(70,130,255,0.95)'
    } else if (t.kind === 'block' || t.kind === 'wreck') {
      top = 'rgba(255,150,50,0.9)'
      side = 'rgba(150,80,20,0.9)'
    } else if (lead) {
      top = 'rgba(90,170,255,0.95)'
      side = 'rgba(40,90,170,0.95)'
    }
    if (t.signal !== 0 && t.kind === 'vehicle' && flash) edge = 'rgba(255,190,40,0.9)'
    this.box(corners, height, top, side, edge)
  }

  private egoCar(ap: Autopilot): void {
    const L = 4.97
    const W = 1.96
    const corners: [number, number, number][] = [
      [L / 2, W / 2, 0],
      [L / 2, -W / 2, 0],
      [-L / 2, -W / 2, 0],
      [-L / 2, W / 2, 0],
    ]
    const { ctx } = this
    const center = this.project(0, 0, 0)
    if (center) {
      const g = ctx.createRadialGradient(center.x, center.y, 2, center.x, center.y, 60 * this.dpr)
      g.addColorStop(0, ap.engaged ? (ap.status.takeover ? 'rgba(255,60,50,0.5)' : 'rgba(60,150,255,0.45)') : 'rgba(255,255,255,0.12)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(center.x - 70 * this.dpr, center.y - 50 * this.dpr, 140 * this.dpr, 100 * this.dpr)
    }
    this.box(corners, 1.15, 'rgba(242,244,248,1)', 'rgba(150,156,168,1)', null)
    // Glass roof.
    const roof: [number, number, number][] = [
      [0.9, 0.62, 1.15],
      [0.9, -0.62, 1.15],
      [-1.5, -0.6, 1.15],
      [-1.5, 0.6, 1.15],
    ]
    const r = roof.map((c) => this.project(c[0], c[1], c[2]))
    if (r.every((q) => q)) {
      ctx.beginPath()
      r.forEach((q, i) => (i ? ctx.lineTo(q!.x, q!.y) : ctx.moveTo(q!.x, q!.y)))
      ctx.closePath()
      ctx.fillStyle = 'rgba(40,46,58,0.9)'
      ctx.fill()
    }
  }
}

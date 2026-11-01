import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LANE_WIDTH, LANES, MEDIAN_HALF, ROAD_EDGE } from '../sim/config'
import type { Road, RoadPoint } from '../sim/road'
import { fbm, rand01, valueNoise } from './noise'

/**
 * The coast highway, built in 100 m chunks around the car: asphalt with US-style markings
 * (yellow inner edge, dashed lane lines, white outer edge), a concrete median barrier, W-beam
 * guard rails, street lights and overhead sign gantries. Inland (+d) the hills climb into
 * golden grass, pines and rock; seaward (-d) an embankment drops to a beach. Chunks are
 * created ahead and dropped behind as the car moves.
 */

const CHUNK = 100
const ROW = 4
const AHEAD = 1300
const BEHIND = 160
const PAVE = ROAD_EDGE + 0.8
const TEX_ALONG = 24
export const RAIL_D = ROAD_EDGE + 0.35

type Tier = 'low' | 'high'

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.RepeatWrapping
  return t
}

/** Road texture: u across the full width (both carriageways), v along 24 m. */
function roadTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const W = 2048
  const H = 512
  const pxPerM = W / (PAVE * 2)
  const vPerM = H / TEX_ALONG
  const u = (d: number) => (d + PAVE) * pxPerM
  const markings = (ctx: CanvasRenderingContext2D, white: string, yellow: string) => {
    for (const side of [-1, 1]) {
      const line = (d: number, width: number, color: string, dashed: boolean) => {
        ctx.fillStyle = color
        const x = u(side * d) - (width * pxPerM) / 2
        if (!dashed) ctx.fillRect(x, 0, width * pxPerM, H)
        else for (let s = 0; s < TEX_ALONG; s += 12) ctx.fillRect(x, s * vPerM, width * pxPerM, 3 * vPerM)
      }
      line(MEDIAN_HALF - 0.12, 0.13, yellow, false)
      for (let k = 1; k < LANES; k++) line(MEDIAN_HALF + LANE_WIDTH * k, 0.13, white, true)
      line(MEDIAN_HALF + LANE_WIDTH * LANES + 0.1, 0.16, white, false)
    }
  }
  const map = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#5c5c60'
    ctx.fillRect(0, 0, W, H)
    const img = ctx.getImageData(0, 0, W, H)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 20 + (Math.random() < 0.015 ? 22 : 0)
      img.data[i] += n
      img.data[i + 1] += n
      img.data[i + 2] += n + 1
    }
    ctx.putImageData(img, 0, 0)
    // Slightly darker, polished wheel tracks in every lane.
    ctx.fillStyle = 'rgba(10,10,12,0.09)'
    for (const side of [-1, 1]) {
      for (let k = 0; k < LANES; k++) {
        const c = MEDIAN_HALF + LANE_WIDTH * (k + 0.5)
        for (const off of [-0.85, 0.85]) ctx.fillRect(u(side * (c + off)) - 0.35 * pxPerM, 0, 0.7 * pxPerM, H)
      }
      // Shoulders a shade lighter and rougher.
      ctx.fillStyle = 'rgba(120,115,105,0.1)'
      const a = u(side * (MEDIAN_HALF + LANE_WIDTH * LANES + 0.2))
      const b = u(side * PAVE)
      ctx.fillRect(Math.min(a, b), 0, Math.abs(b - a), H)
      ctx.fillStyle = 'rgba(10,10,12,0.09)'
    }
    // Tar seams.
    ctx.strokeStyle = 'rgba(25,25,25,0.35)'
    ctx.lineWidth = 1
    for (let i = 0; i < 6; i++) {
      ctx.beginPath()
      let x = Math.random() * W
      let y = Math.random() * H
      ctx.moveTo(x, y)
      for (let j = 0; j < 8; j++) {
        x += (Math.random() - 0.5) * 40
        y += Math.random() * 30
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    markings(ctx, '#e6e4dc', '#e2b23a')
  })
  const rough = canvasTexture(
    W,
    H,
    (ctx) => {
      ctx.fillStyle = '#a8a8a8'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#929292'
      for (const side of [-1, 1]) {
        for (let k = 0; k < LANES; k++) {
          const c = MEDIAN_HALF + LANE_WIDTH * (k + 0.5)
          for (const off of [-0.85, 0.85]) ctx.fillRect(u(side * (c + off)) - 0.35 * pxPerM, 0, 0.7 * pxPerM, H)
        }
      }
      markings(ctx, '#606060', '#606060')
    },
    false,
  )
  return { map, rough }
}

function signTexture(lines: [string, string][]): THREE.CanvasTexture {
  const t = canvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = '#0d5a33'
    ctx.fillRect(0, 0, 1024, 256)
    ctx.strokeStyle = '#e8efe9'
    ctx.lineWidth = 8
    ctx.strokeRect(10, 10, 1004, 236)
    ctx.fillStyle = '#f2f5f2'
    ctx.font = 'bold 74px "IBM Plex Sans", Arial, sans-serif'
    ctx.textBaseline = 'middle'
    lines.forEach(([left, right], i) => {
      const y = 76 + i * 104
      ctx.textAlign = 'left'
      ctx.fillText(left, 44, y)
      ctx.textAlign = 'right'
      ctx.fillText(right, 980, y)
    })
  })
  t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

const SIGNS: [string, string][][] = [
  [['Seacrest Bay', '12'], ['Harbor City', '38']],
  [['Rosewood Point', '6'], ['Palm Hollow', '21']],
  [['Gull Rock', '3'], ['Cape Lantern', '27']],
  [['EXIT 41  Cliff Rd', '1 ⁄ 2'], ['Lighthouse Beach', '9']],
  [['Sunset Pier', '15'], ['Bayview', '44']],
]

/** Inland (+d) and seaward (-d) terrain height relative to the world, at road s and outward offset `off` beyond the pavement. */
export function terrainHeight(road: Road, s: number, side: 1 | -1, off: number): number {
  const ry = road.elevation(s)
  if (side > 0) {
    const ridge = 30 + 55 * fbm(s * 0.0011, 3.1, 3)
    const rise = ridge * (1 - Math.exp(-Math.max(0, off - 4) / 70))
    const bumps = (fbm(s * 0.006, off * 0.012, 4) - 0.5) * Math.min(1, off / 25) * 22
    const ditch = off < 4 ? -0.35 * Math.sin((off / 4) * Math.PI) : 0
    return ry + rise + bumps + ditch
  }
  const beach = beachDistance(s)
  const drop = ry + 2.8
  const t = THREE.MathUtils.smoothstep(off, 3, beach)
  const rocky = (fbm(s * 0.01, off * 0.03, 3) - 0.5) * 6 * Math.sin(t * Math.PI)
  if (off < beach) return ry - 0.25 - drop * t ** 1.4 + rocky
  return -2.55 - Math.min(6, (off - beach) * 0.08)
}

export function beachDistance(s: number): number {
  return 26 + 85 * fbm(s * 0.0018, 7.7, 3)
}

const LAND_OFFSETS = [0, 2, 4.5, 8, 14, 22, 34, 50, 72, 100, 140, 190, 260, 340]
const SEA_OFFSETS = [0, 1.5, 3.5, 7, 12, 19, 28, 40, 55, 75, 100, 130, 170, 230]

const tmpColor = new THREE.Color()
const GRASS = new THREE.Color(0.28, 0.31, 0.11)
const DRY = new THREE.Color(0.5, 0.39, 0.18)
const ROCK = new THREE.Color(0.45, 0.4, 0.35)
const SAND = new THREE.Color(0.7, 0.58, 0.41)
const WET = new THREE.Color(0.5, 0.42, 0.33)
const SCRUB = new THREE.Color(0.3, 0.32, 0.17)

type Materials = {
  road: THREE.MeshStandardMaterial
  concrete: THREE.MeshStandardMaterial
  steel: THREE.MeshStandardMaterial
  terrain: THREE.MeshStandardMaterial
  bark: THREE.MeshStandardMaterial
  pine: THREE.MeshStandardMaterial
  palm: THREE.MeshStandardMaterial
  rock: THREE.MeshStandardMaterial
  lamp: THREE.MeshBasicMaterial
  pole: THREE.MeshStandardMaterial
  signs: THREE.MeshStandardMaterial[]
  signBack: THREE.MeshStandardMaterial
}

function detailTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 256, (ctx) => {
    const img = ctx.createImageData(256, 256)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = 200 + (Math.random() - 0.5) * 90
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

type Prototypes = {
  pineTrunk: THREE.BufferGeometry
  pineCrown: THREE.BufferGeometry
  palmTrunk: THREE.BufferGeometry
  palmCrown: THREE.BufferGeometry
  rock: THREE.BufferGeometry
  post: THREE.BufferGeometry
  lampPole: THREE.BufferGeometry
  lampHead: THREE.BufferGeometry
}

function buildPrototypes(): Prototypes {
  const cones: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    const r = 2.6 - i * 0.55
    const c = new THREE.ConeGeometry(r, 3.6 - i * 0.4, 9, 1)
    c.translate(0, 3.2 + i * 2.1, 0)
    cones.push(c)
  }
  const pineCrown = mergeGeometries(cones.map((g) => g.toNonIndexed()))!
  const pineTrunk = new THREE.CylinderGeometry(0.16, 0.28, 4, 6).translate(0, 2, 0)

  // A leaning palm: curved trunk and a crown of drooping fronds.
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.4, 3, 0), new THREE.Vector3(1.4, 6, 0), new THREE.Vector3(2.6, 8.4, 0)])
  const palmTrunk = new THREE.TubeGeometry(curve, 10, 0.2, 6, false)
  const fronds: THREE.BufferGeometry[] = []
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const g = new THREE.PlaneGeometry(3.6, 0.7, 4, 1)
    const pos = g.attributes.position
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v) + 1.8
      pos.setXYZ(v, x, -0.12 * x * x + pos.getY(v) * 0.15, pos.getY(v) * (1 - x / 4.2))
    }
    g.rotateY(a)
    g.translate(2.6, 8.4, 0)
    fronds.push(g.toNonIndexed())
  }
  const palmCrown = mergeGeometries(fronds)!
  palmCrown.computeVertexNormals()

  const rock = new THREE.DodecahedronGeometry(1, 1)
  const rp = rock.attributes.position
  for (let i = 0; i < rp.count; i++) {
    const k = 0.75 + valueNoise(rp.getX(i) * 2.1 + 9, rp.getZ(i) * 2.3) * 0.5
    rp.setXYZ(i, rp.getX(i) * k * 1.3, rp.getY(i) * k * 0.7, rp.getZ(i) * k)
  }
  rock.computeVertexNormals()

  const post = new THREE.BoxGeometry(0.12, 0.85, 0.16).translate(0, 0.42, 0)
  // Street light: pole plus an arm reaching over the road (+z in its local frame).
  const pole = new THREE.CylinderGeometry(0.09, 0.13, 9.5, 6).translate(0, 4.75, 0)
  const arm = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5).rotateX(Math.PI / 2).translate(0, 9.4, 1.25)
  const lampPole = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()])!
  const lampHead = new THREE.BoxGeometry(0.38, 0.14, 0.9).translate(0, 9.32, 2.55)
  return { pineTrunk, pineCrown, palmTrunk, palmCrown, rock, post, lampPole, lampHead }
}

export class WorldView {
  private readonly scene: THREE.Scene
  private readonly road: Road
  private readonly tier: Tier
  private readonly chunks = new Map<number, THREE.Group>()
  private readonly m: Materials
  private readonly proto: Prototypes
  private readonly pt: RoadPoint = { x: 0, y: 0, z: 0, psi: 0, kappa: 0 }

  constructor(scene: THREE.Scene, road: Road, tier: Tier) {
    this.scene = scene
    this.road = road
    this.tier = tier
    const { map, rough } = roadTextures()
    const detail = detailTexture()
    detail.repeat.set(30, 30)
    this.m = {
      road: new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.9 }),
      concrete: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.3, 0.29, 0.27), roughness: 0.85 }),
      steel: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.7, 0.72, 0.74), roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }),
      terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: detail, envMapIntensity: 0.4 }),
      bark: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.24, 0.17, 0.12), roughness: 0.9 }),
      pine: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.12, 0.2, 0.1), roughness: 0.85, flatShading: true }),
      palm: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.3, 0.12), roughness: 0.75, side: THREE.DoubleSide }),
      rock: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.44, 0.4, 0.36), roughness: 0.9, flatShading: true }),
      lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 3.6, 1.8) }),
      pole: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.35, 0.36, 0.38), roughness: 0.5, metalness: 0.7 }),
      signs: SIGNS.map((lines) => new THREE.MeshStandardMaterial({ map: signTexture(lines), roughness: 0.4, emissive: new THREE.Color(0.06, 0.07, 0.06) })),
      signBack: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.4, 0.42, 0.44), roughness: 0.6, metalness: 0.6 }),
    }
    this.proto = buildPrototypes()
  }

  reset(): void {
    for (const [i, g] of this.chunks) {
      this.disposeChunk(g)
      this.chunks.delete(i)
    }
  }

  update(egoS: number): void {
    const first = Math.max(0, Math.floor((egoS - BEHIND) / CHUNK))
    const last = Math.floor((egoS + AHEAD) / CHUNK)
    for (const [i, g] of this.chunks) {
      if (i < first || i > last) {
        this.disposeChunk(g)
        this.chunks.delete(i)
      }
    }
    // Build at most two per frame to avoid hitches.
    let built = 0
    for (let i = first; i <= last && built < 2; i++) {
      if (this.chunks.has(i)) continue
      const g = this.buildChunk(i)
      this.chunks.set(i, g)
      this.scene.add(g)
      built++
    }
  }

  private disposeChunk(g: THREE.Group): void {
    this.scene.remove(g)
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.own) o.geometry.dispose()
      if (o instanceof THREE.InstancedMesh) o.dispose()
    })
  }

  private p(s: number, d: number): RoadPoint {
    return this.road.point(s, d, this.pt)
  }

  /** Grid mesh along the road: `cols(s)` gives each column's (d, y offset or absolute y). */
  private ribbon(s0: number, s1: number, step: number, cols: (s: number, row: number) => [number, number, boolean][], uv: (s: number, c: number, d: number) => [number, number], color?: (s: number, c: number, d: number, y: number) => THREE.Color): THREE.BufferGeometry {
    const rows = Math.round((s1 - s0) / step) + 1
    const positions: number[] = []
    const uvs: number[] = []
    const colors: number[] = []
    let ncols = 0
    for (let r = 0; r < rows; r++) {
      const s = s0 + r * step
      const cs = cols(s, r)
      ncols = cs.length
      for (let c = 0; c < cs.length; c++) {
        const [d, y, absolute] = cs[c]
        const p = this.p(s, d)
        const wy = absolute ? y : p.y + y
        positions.push(p.x, wy, p.z)
        const [u, v] = uv(s, c, d)
        uvs.push(u, v)
        if (color) {
          const col = color(s, c, d, wy)
          colors.push(col.r, col.g, col.b)
        }
      }
    }
    const index: number[] = []
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < ncols - 1; c++) {
        const a = r * ncols + c
        const b = a + ncols
        index.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material, cast = false, receive = true): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m)
    mesh.castShadow = cast
    mesh.receiveShadow = receive
    mesh.userData.own = true
    mesh.matrixAutoUpdate = false
    return mesh
  }

  private buildChunk(i: number): THREE.Group {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    const s0 = i * CHUNK
    const s1 = s0 + CHUNK
    const road = this.road
    road.ensure(s1 + 10)

    // Asphalt (both carriageways) with the cross-section's columns flat.
    const surface = this.ribbon(
      s0,
      s1,
      ROW,
      () => [
        [-PAVE, 0, false],
        [-ROAD_EDGE, 0, false],
        [0, 0, false],
        [ROAD_EDGE, 0, false],
        [PAVE, 0, false],
      ],
      (s, _c, d) => [(d + PAVE) / (PAVE * 2), s / TEX_ALONG],
    )
    group.add(this.mesh(surface, this.m.road))

    // Jersey barrier in the median.
    const jersey: [number, number][] = [
      [-0.3, 0],
      [-0.27, 0.08],
      [-0.12, 0.32],
      [-0.08, 0.84],
      [0.08, 0.84],
      [0.12, 0.32],
      [0.27, 0.08],
      [0.3, 0],
    ]
    const barrier = this.ribbon(
      s0,
      s1,
      ROW,
      () => jersey.map(([d, y]) => [d, y, false] as [number, number, boolean]),
      (s, c) => [c / 7, s / 4],
    )
    group.add(this.mesh(barrier, this.m.concrete, true))

    // Guard rails (W-beam) on both outer edges, facing the road.
    for (const side of [-1, 1] as const) {
      const d = side * RAIL_D
      const rail = this.ribbon(
        s0,
        s1,
        ROW,
        () => [
          [d, 0.52, false],
          [d + side * 0.07, 0.6, false],
          [d, 0.67, false],
          [d + side * 0.07, 0.74, false],
          [d, 0.82, false],
        ],
        (s, c) => [c / 4, s / 4],
      )
      group.add(this.mesh(rail, this.m.steel, true))
    }
    const posts = new THREE.InstancedMesh(this.proto.post, this.m.pole, Math.ceil(CHUNK / 4) * 2)
    const mtx = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3(1, 1, 1)
    let n = 0
    for (let s = s0; s < s1; s += 4) {
      for (const side of [-1, 1]) {
        const p = this.p(s, side * (RAIL_D + 0.12))
        q.setFromAxisAngle(up, p.psi)
        posts.setMatrixAt(n++, mtx.compose(pos.set(p.x, p.y, p.z), q, scl))
      }
    }
    posts.count = n
    posts.castShadow = true
    group.add(posts)

    // Terrain on both sides.
    for (const side of [1, -1] as const) {
      const offsets = side > 0 ? LAND_OFFSETS : SEA_OFFSETS
      const geo = this.ribbon(
        s0,
        s1,
        side > 0 ? 5 : 5,
        (s) => offsets.map((off) => [side * (PAVE + off), terrainHeight(road, s, side, off), true] as [number, number, boolean]),
        (s, _c, d) => [d / 6, s / 6],
        (s, c, _d, y) => this.terrainColor(s, side, offsets[c], y),
      )
      // Seaward columns run toward -d, which flips the winding; turn it back up.
      if (side < 0) flipWinding(geo)
      group.add(this.mesh(geo, this.m.terrain, false, true))
    }

    this.scatter(group, i, s0, s1)
    if (i % 11 === 4) this.gantry(group, s0 + 40, i)
    group.updateMatrixWorld(true)
    return group
  }

  private terrainColor(s: number, side: 1 | -1, off: number, y: number): THREE.Color {
    const n = fbm(s * 0.02, off * 0.05, 3)
    if (side > 0) {
      const steep = THREE.MathUtils.smoothstep(off, 30, 120) * 0.5 + (n > 0.62 ? 0.5 : 0)
      tmpColor.copy(GRASS).lerp(DRY, THREE.MathUtils.clamp(n * 1.4 - 0.2, 0, 1))
      return tmpColor.lerp(ROCK, THREE.MathUtils.clamp(steep, 0, 0.85))
    }
    if (y < -0.4) return tmpColor.copy(WET).multiplyScalar(0.8)
    if (y < 1.2) return tmpColor.copy(SAND).lerp(WET, THREE.MathUtils.clamp((1.2 - y) / 1.6, 0, 1) * 0.6)
    if (off < 3) return tmpColor.copy(DRY).multiplyScalar(0.8)
    tmpColor.copy(SCRUB).lerp(DRY, n)
    return tmpColor.lerp(ROCK, THREE.MathUtils.clamp((n - 0.55) * 2.5, 0, 0.7))
  }

  private scatter(group: THREE.Group, i: number, s0: number, s1: number): void {
    const road = this.road
    const dense = this.tier === 'high'
    const mtx = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()

    const pines: THREE.Matrix4[] = []
    const palms: THREE.Matrix4[] = []
    const rocks: THREE.Matrix4[] = []
    const treeCount = dense ? 46 : 20
    for (let k = 0; k < treeCount; k++) {
      const s = s0 + rand01(i * 131 + k, 1) * CHUNK
      const off = 9 + rand01(i * 131 + k, 2) ** 1.6 * 230
      // Clumps: skip where the clump noise is low.
      if (fbm(s * 0.008, off * 0.01, 2) < 0.42) continue
      const p = road.point(s, PAVE + off)
      const y = terrainHeight(road, s, 1, off)
      const size = 0.7 + rand01(i + k, 3) * 0.9
      e.set(0, rand01(k, i) * 6.28, 0)
      pines.push(new THREE.Matrix4().compose(pos.set(p.x, y - 0.3, p.z), q.setFromEuler(e), scl.set(size, size * (0.9 + rand01(k, 7) * 0.5), size)))
    }
    const beach = beachDistance((s0 + s1) / 2)
    for (let k = 0; k < (dense ? 7 : 4); k++) {
      const s = s0 + rand01(i * 71 + k, 5) * CHUNK
      const off = 6 + rand01(i * 71 + k, 6) * Math.max(4, beachDistance(s) - 4)
      const p = road.point(s, -(PAVE + off))
      const y = terrainHeight(road, s, -1, off)
      if (y < 0.3) continue
      const size = 0.8 + rand01(i + k, 8) * 0.5
      e.set(0, rand01(k, i + 3) * 6.28, 0)
      palms.push(new THREE.Matrix4().compose(pos.set(p.x, y - 0.2, p.z), q.setFromEuler(e), scl.set(size, size, size)))
    }
    for (let k = 0; k < (dense ? 14 : 7); k++) {
      const s = s0 + rand01(i * 37 + k, 9) * CHUNK
      const seaward = k % 3 !== 0
      const off = seaward ? beach - 10 + rand01(k, i * 3) * 30 : 20 + rand01(k, i * 5) * 140
      const side: 1 | -1 = seaward ? -1 : 1
      const p = road.point(s, side * (PAVE + off))
      const y = terrainHeight(road, s, side, off)
      const size = 1 + rand01(k, i + 11) * (seaward ? 3.5 : 6)
      e.set(rand01(k, 1) * 3, rand01(k, 2) * 6.28, rand01(k, 3) * 3)
      rocks.push(new THREE.Matrix4().compose(pos.set(p.x, y - size * 0.25, p.z), q.setFromEuler(e), scl.set(size, size, size)))
    }
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], cast: boolean) => {
      if (!list.length) return
      const m = new THREE.InstancedMesh(geo, mat, list.length)
      list.forEach((x, j) => m.setMatrixAt(j, x))
      m.castShadow = cast
      m.receiveShadow = true
      m.computeBoundingSphere()
      group.add(m)
    }
    inst(this.proto.pineTrunk, this.m.bark, pines, false)
    inst(this.proto.pineCrown, this.m.pine, pines, true)
    inst(this.proto.palmTrunk, this.m.bark, palms, true)
    inst(this.proto.palmCrown, this.m.palm, palms, true)
    inst(this.proto.rock, this.m.rock, rocks, true)

    // Street lights on both edges, every 50 m, staggered.
    const lamps: THREE.Matrix4[] = []
    for (let s = s0 + (i % 2) * 25; s < s1; s += 50) {
      for (const side of [-1, 1]) {
        const p = road.point(s, side * (RAIL_D + 0.9))
        // The arm points toward the road (local +z → toward -side·left).
        e.set(0, p.psi + (side > 0 ? 0 : Math.PI), 0)
        lamps.push(new THREE.Matrix4().compose(pos.set(p.x, p.y, p.z), q.setFromEuler(e), scl.set(1, 1, 1)))
      }
    }
    inst(this.proto.lampPole, this.m.pole, lamps, true)
    inst(this.proto.lampHead, this.m.lamp, lamps, false)
    void mtx
  }

  private gantry(group: THREE.Group, s: number, i: number): void {
    const road = this.road
    const kit: THREE.BufferGeometry[] = []
    const p0 = road.point(s, -(RAIL_D + 1.2))
    const p1 = road.point(s, -0.9)
    const psi = p0.psi
    const height = 7.2
    const addBox = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => {
      const b = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed()
      b.rotateY(psi)
      b.translate(cx, cy, cz)
      kit.push(b)
    }
    const base = Math.min(p0.y, p1.y)
    for (const p of [p0, p1]) addBox(p.x, base + height / 2, p.z, 0.45, height, 0.45)
    const mid = road.point(s, (-(RAIL_D + 1.2) - 0.9) / 2)
    const span = RAIL_D + 1.2 - 0.9
    // Truss: two chords along the span (local z is across the road).
    for (const y of [height - 0.15, height - 1.0]) {
      const b = new THREE.BoxGeometry(0.25, 0.25, span).toNonIndexed()
      b.rotateY(psi)
      b.translate(mid.x, base + y, mid.z)
      kit.push(b)
    }
    group.add(this.mesh(mergeGeometries(kit)!, this.m.signBack, true, false))
    // Two sign panels facing oncoming (our) traffic: their front faces -forward.
    for (const [k, d] of [
      [0, laneCenterD(0.5)],
      [1, laneCenterD(2.1)],
    ] as const) {
      const p = road.point(s - 0.3, d)
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.4), this.m.signs[(i + k) % this.m.signs.length])
      panel.position.set(p.x, base + height - 0.6, p.z)
      // Plane faces +z by default; rotate so it faces back down the road (-forward).
      panel.rotation.set(0, psi - Math.PI / 2, 0)
      panel.userData.own = true
      panel.castShadow = true
      group.add(panel)
    }
  }
}

function laneCenterD(lane: number): number {
  return -(MEDIAN_HALF + LANE_WIDTH * (lane + 0.5))
}

function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.index!
  const a = idx.array as Uint16Array | Uint32Array
  for (let i = 0; i < a.length; i += 3) {
    const t = a[i + 1]
    a[i + 1] = a[i + 2]
    a[i + 2] = t
  }
  idx.needsUpdate = true
  g.computeVertexNormals()
}

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { naturalHeight } from './heights'

export type Surface = 'gravel' | 'tarmac' | 'grass'

export type TrackSample = {
  /** Centerline point at road height. */
  position: THREE.Vector3
  /** Horizontal direction of travel. */
  tangent: THREE.Vector3
  /** Horizontal, points to the left of travel. */
  binormal: THREE.Vector3
  distance: number
  surface: 'gravel' | 'tarmac'
}

export type ElevationFeature = { kind: 'jump' | 'crest'; distance: number }

export type TrackProjection = {
  index: number
  distance: number
  lateral: number
  roadHeight: number
}

const HALF_WIDTH = 5.5
const SHOULDER = 2.5
const SHOULDER_DROP = 0.45
const SAMPLE_SPACING = 1
const COARSE_STEP = 8
const LOCAL_SEARCH = 40
const TARMAC_RANGE: [number, number] = [0.48, 0.6]
const RIBBON_OFFSETS = [
  -(HALF_WIDTH + SHOULDER),
  -HALF_WIDTH,
  -HALF_WIDTH * 0.5,
  0,
  HALF_WIDTH * 0.5,
  HALF_WIDTH,
  HALF_WIDTH + SHOULDER,
]
const RIBBON_DROPS = [SHOULDER_DROP, 0, 0, 0, 0, 0, SHOULDER_DROP]

function buildCenterline(): THREE.CatmullRomCurve3 {
  const lobes = [
    { r: 72 },
    { r: 58 },
    { r: 80 },
    { r: 50 },
    { r: 70 },
    { r: 55 },
    { r: 76 },
    { r: 52 },
  ]
  const scale = 1.55
  const n = 48
  const pts: THREE.Vector3[] = []

  for (let i = 0; i < n; i++) {
    const t = i / n
    const angle = t * Math.PI * 2
    const f = t * lobes.length
    const lobe = lobes[Math.floor(f) % lobes.length]
    const next = lobes[(Math.floor(f) + 1) % lobes.length]
    const radius =
      (THREE.MathUtils.lerp(lobe.r, next.r, f % 1) +
        Math.sin(angle * 3.2) * 6 +
        Math.cos(angle * 5.1) * 3) *
      scale
    pts.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
  }

  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.35)
}

function circularSmooth(values: Float32Array, radius: number): Float32Array {
  const n = values.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let o = -radius; o <= radius; o++) sum += values[(i + o + n) % n]
    out[i] = sum / (radius * 2 + 1)
  }
  return out
}

export class Track {
  readonly halfWidth = HALF_WIDTH
  readonly shoulder = SHOULDER
  readonly samples: TrackSample[] = []
  readonly features: ElevationFeature[] = []
  readonly length: number
  readonly spacing: number
  readonly ribbonPositions: Float32Array
  readonly ribbonIndices: Uint32Array
  private readonly ribbonColors: Float32Array
  private readonly ribbonUvs: Float32Array

  constructor() {
    const curve = buildCenterline()
    const rawLength = curve.getLength()
    const n = Math.round(rawLength / SAMPLE_SPACING)
    const pts = curve.getSpacedPoints(n).slice(0, n)
    this.length = rawLength
    this.spacing = rawLength / n

    const tangents = pts.map((_, i) => {
      const prev = pts[(i - 1 + n) % n]
      const next = pts[(i + 1) % n]
      return new THREE.Vector3(next.x - prev.x, 0, next.z - prev.z).normalize()
    })

    let base: Float32Array = new Float32Array(n)
    for (let i = 0; i < n; i++) base[i] = naturalHeight(pts[i].x, pts[i].z)
    base = circularSmooth(circularSmooth(base, 25), 25)

    this.pickFeatures(tangents)

    for (let i = 0; i < n; i++) {
      const distance = i * this.spacing
      const frac = distance / this.length
      const tangent = tangents[i]
      this.samples.push({
        position: new THREE.Vector3(pts[i].x, base[i] + this.featureHeight(distance), pts[i].z),
        tangent,
        binormal: new THREE.Vector3(tangent.z, 0, -tangent.x),
        distance,
        surface: frac > TARMAC_RANGE[0] && frac < TARMAC_RANGE[1] ? 'tarmac' : 'gravel',
      })
    }

    const ribbon = this.buildRibbon()
    this.ribbonPositions = ribbon.positions
    this.ribbonIndices = ribbon.indices
    this.ribbonColors = ribbon.colors
    this.ribbonUvs = ribbon.uvs
  }

  get count(): number {
    return this.samples.length
  }

  sample(index: number): TrackSample {
    const n = this.samples.length
    return this.samples[((index % n) + n) % n]
  }

  /** Straightest sections get jumps, the next ones get crests. */
  private pickFeatures(tangents: THREE.Vector3[]): void {
    const n = tangents.length
    const curvature = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const a = tangents[(i - 5 + n) % n]
      const b = tangents[(i + 5) % n]
      curvature[i] = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1))
    }

    const window = Math.round(35 / this.spacing)
    const candidates: { index: number; cost: number }[] = []
    for (let c = 0; c < n; c += 4) {
      let cost = 0
      for (let o = -window; o <= window; o++) cost += curvature[(c + o + n) % n]
      candidates.push({ index: c, cost })
    }
    candidates.sort((a, b) => a.cost - b.cost)

    const circ = (a: number, b: number) => {
      const d = Math.abs(a - b) % n
      return Math.min(d, n - d) * this.spacing
    }
    const chosen: number[] = []
    for (const cand of candidates) {
      if (chosen.length >= 5) break
      if (circ(cand.index, 0) < 70) continue
      if (chosen.some((c) => circ(c, cand.index) < 90)) continue
      chosen.push(cand.index)
    }

    chosen.forEach((index, i) => {
      this.features.push({ kind: i < 2 ? 'jump' : 'crest', distance: index * this.spacing })
    })
  }

  private featureHeight(distance: number): number {
    let h = 0
    for (const f of this.features) {
      let s = distance - f.distance
      if (s > this.length / 2) s -= this.length
      if (s < -this.length / 2) s += this.length

      if (f.kind === 'crest') {
        const w = 20
        if (Math.abs(s) < w) h += 1.6 * 0.5 * (1 + Math.cos((Math.PI * s) / w))
      } else {
        const approach = 14
        const drop = 16
        const height = 1.4
        if (s >= -approach && s <= 0) h += height * ((s + approach) / approach) ** 2
        else if (s > 0 && s < drop) h += height * (1 - s / drop) ** 2
      }
    }
    return h
  }

  private buildRibbon() {
    const n = this.samples.length
    const cols = RIBBON_OFFSETS.length
    const rows = n + 1
    const positions = new Float32Array(rows * cols * 3)
    const colors = new Float32Array(rows * cols * 3)
    const uvs = new Float32Array(rows * cols * 2)
    const indices: number[] = []

    const gravel = new THREE.Color(0x9a6a3c)
    const tarmac = new THREE.Color(0x4a4744)
    const shoulder = new THREE.Color(0x6a4a2c)

    for (let r = 0; r < rows; r++) {
      const s = this.samples[r % n]
      const distance = r === n ? this.length : s.distance
      for (let c = 0; c < cols; c++) {
        const v = (r * cols + c) * 3
        positions[v] = s.position.x + s.binormal.x * RIBBON_OFFSETS[c]
        positions[v + 1] = s.position.y - RIBBON_DROPS[c]
        positions[v + 2] = s.position.z + s.binormal.z * RIBBON_OFFSETS[c]

        const col = c === 0 || c === cols - 1 ? shoulder : s.surface === 'tarmac' ? tarmac : gravel
        colors[v] = col.r
        colors[v + 1] = col.g
        colors[v + 2] = col.b

        const u = (r * cols + c) * 2
        uvs[u] = c / (cols - 1)
        uvs[u + 1] = distance / 8
      }
    }

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c
        const b = a + 1
        const cc = a + cols
        const d = cc + 1
        indices.push(a, cc, b, b, cc, d)
      }
    }

    return { positions, colors, uvs, indices: new Uint32Array(indices) }
  }

  /** Closest point on the centerline. Pass a hint index for a fast local search. */
  project(x: number, z: number, hint?: number): TrackProjection {
    const n = this.samples.length
    let best = -1
    let bestD = Infinity

    const test = (i: number) => {
      const p = this.sample(i).position
      const d = (p.x - x) ** 2 + (p.z - z) ** 2
      if (d < bestD) {
        bestD = d
        best = ((i % n) + n) % n
      }
    }

    if (hint !== undefined) {
      for (let o = -LOCAL_SEARCH; o <= LOCAL_SEARCH; o++) test(hint + o)
    }
    if (hint === undefined || bestD > 30 * 30) {
      for (let i = 0; i < n; i += COARSE_STEP) test(i)
      const coarse = best
      for (let o = -COARSE_STEP; o <= COARSE_STEP; o++) test(coarse + o)
    }

    const a = this.projectSegment(best - 1, x, z)
    const b = this.projectSegment(best, x, z)
    return a.distSq < b.distSq ? a.result : b.result
  }

  private projectSegment(i: number, x: number, z: number) {
    const n = this.samples.length
    const index = ((i % n) + n) % n
    const sa = this.samples[index]
    const sb = this.samples[(index + 1) % n]
    const abx = sb.position.x - sa.position.x
    const abz = sb.position.z - sa.position.z
    const lenSq = abx * abx + abz * abz
    const t = THREE.MathUtils.clamp(((x - sa.position.x) * abx + (z - sa.position.z) * abz) / lenSq, 0, 1)
    const cx = sa.position.x + abx * t
    const cz = sa.position.z + abz * t
    const dx = x - cx
    const dz = z - cz

    return {
      distSq: dx * dx + dz * dz,
      result: {
        index,
        distance: sa.distance + t * this.spacing,
        lateral: dx * sa.binormal.x + dz * sa.binormal.z,
        roadHeight: THREE.MathUtils.lerp(sa.position.y, sb.position.y, t),
      },
    }
  }

  pointAt(distance: number): { position: THREE.Vector3; tangent: THREE.Vector3; index: number } {
    const d = ((distance % this.length) + this.length) % this.length
    const f = d / this.spacing
    const i = Math.floor(f)
    const a = this.sample(i)
    const b = this.sample(i + 1)
    return {
      position: a.position.clone().lerp(b.position, f - i),
      tangent: a.tangent.clone().lerp(b.tangent, f - i).normalize(),
      index: i % this.samples.length,
    }
  }

  surfaceAt(proj: TrackProjection): Surface {
    const lat = Math.abs(proj.lateral)
    if (lat > HALF_WIDTH + SHOULDER) return 'grass'
    if (lat > HALF_WIDTH) return 'gravel'
    return this.samples[proj.index].surface
  }

  createColliders(world: RAPIER.World): RAPIER.Collider {
    const road = world.createCollider(
      RAPIER.ColliderDesc.trimesh(this.ribbonPositions, this.ribbonIndices).setFriction(0.8),
    )

    const start = this.samples[0]
    for (const side of [-1, 1]) {
      const off = side * (HALF_WIDTH + SHOULDER + 0.6)
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.15, 2.8, 0.15).setTranslation(
          start.position.x + start.binormal.x * off,
          start.position.y + 2.4,
          start.position.z + start.binormal.z * off,
        ),
      )
    }

    return road
  }

  createMeshes(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'track'

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.ribbonPositions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.ribbonColors, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(this.ribbonUvs, 2))
    geo.setIndex(new THREE.BufferAttribute(this.ribbonIndices, 1))
    geo.computeVertexNormals()

    const road = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: createGravelTexture(),
        roughness: 0.95,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    )
    road.receiveShadow = true
    group.add(road)
    group.add(this.buildStartGate())
    return group
  }

  private buildStartGate(): THREE.Group {
    const gate = new THREE.Group()
    const start = this.samples[0]
    gate.position.copy(start.position)
    gate.rotation.y = Math.atan2(start.tangent.x, start.tangent.z)

    const postMat = new THREE.MeshStandardMaterial({ color: 0xd4c4a0, roughness: 0.7 })
    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0xc4783a,
      roughness: 0.6,
      emissive: 0x3a1e0a,
      emissiveIntensity: 0.3,
    })
    const span = HALF_WIDTH + SHOULDER + 0.6

    for (const x of [-span, span]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.6, 0.3), postMat)
      post.position.set(x, 2.4, 0)
      post.castShadow = true
      gate.add(post)
    }

    const banner = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.4, 1, 0.14), bannerMat)
    banner.position.set(0, 4.9, 0)
    banner.castShadow = true
    gate.add(banner)

    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_WIDTH * 2, 0.6),
      new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.8 }),
    )
    line.rotation.x = -Math.PI / 2
    line.position.y = 0.04
    gate.add(line)

    return gate
  }
}

function createGravelTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d8d0c4'
  ctx.fillRect(0, 0, size, size)

  for (let i = 0; i < 5000; i++) {
    const shade = 150 + Math.random() * 105
    ctx.fillStyle = `rgb(${shade},${shade * 0.96},${shade * 0.9})`
    const r = Math.random() * 1.8 + 0.4
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r)
  }
  // Wheel ruts
  for (const x of [0.32, 0.68]) {
    const grad = ctx.createLinearGradient((x - 0.06) * size, 0, (x + 0.06) * size, 0)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(0.5, 'rgba(60,40,25,0.22)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect((x - 0.06) * size, 0, 0.12 * size, size)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

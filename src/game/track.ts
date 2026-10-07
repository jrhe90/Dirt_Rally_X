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
export const WALL = {
  offset: HALF_WIDTH + SHOULDER + 0.35,
  thickness: 0.5,
  height: 0.6,
  /** How far below road level the wall footing reaches so it never floats on slopes. */
  footing: 1.4,
  segment: 4,
}
export const RIBBON_OFFSETS = [
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
  readonly ribbonRows: number
  /** Sample index range lined with stone walls on both sides (the tarmac section). */
  readonly wallRange: [number, number]

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
    this.ribbonRows = n + 1

    const margin = Math.round(4 / this.spacing)
    this.wallRange = [Math.ceil(TARMAC_RANGE[0] * n) + margin, Math.floor(TARMAC_RANGE[1] * n) - margin]
  }

  /** 0 on gravel, 1 on tarmac, with a short blend at the boundaries. */
  tarmacWeight(distance: number): number {
    const frac = distance / this.length
    const blend = 3 / this.length
    const a = THREE.MathUtils.smoothstep(frac, TARMAC_RANGE[0] - blend, TARMAC_RANGE[0] + blend)
    const b = 1 - THREE.MathUtils.smoothstep(frac, TARMAC_RANGE[1] - blend, TARMAC_RANGE[1] + blend)
    return Math.min(a, b)
  }

  /** Wall segments as (center, yaw, half length, base height) for both sides of the wall range. */
  wallSegments(): { center: THREE.Vector3; yaw: number; halfLength: number; side: number }[] {
    const out: { center: THREE.Vector3; yaw: number; halfLength: number; side: number }[] = []
    const [start, end] = this.wallRange
    for (const side of [-1, 1]) {
      for (let i = start; i < end; i += WALL.segment) {
        const j = Math.min(i + WALL.segment, end)
        const a = this.sample(i)
        const b = this.sample(j)
        const pa = a.position.clone().addScaledVector(a.binormal, side * WALL.offset)
        const pb = b.position.clone().addScaledVector(b.binormal, side * WALL.offset)
        out.push({
          center: pa.clone().lerp(pb, 0.5),
          yaw: Math.atan2(pb.x - pa.x, pb.z - pa.z),
          halfLength: Math.hypot(pb.x - pa.x, pb.z - pa.z) / 2 + 0.05,
          side,
        })
      }
    }
    return out
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
    const indices: number[] = []

    for (let r = 0; r < rows; r++) {
      const s = this.samples[r % n]
      for (let c = 0; c < cols; c++) {
        const v = (r * cols + c) * 3
        positions[v] = s.position.x + s.binormal.x * RIBBON_OFFSETS[c]
        positions[v + 1] = s.position.y - RIBBON_DROPS[c]
        positions[v + 2] = s.position.z + s.binormal.z * RIBBON_OFFSETS[c]
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

    return { positions, indices: new Uint32Array(indices) }
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
      // Without internal-edge fixing, a chassis scraping the road can catch a triangle edge and stop dead.
      RAPIER.ColliderDesc.trimesh(this.ribbonPositions, this.ribbonIndices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8),
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

    const footY = WALL.footing
    const halfH = (WALL.height + footY) / 2
    for (const seg of this.wallSegments()) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(WALL.thickness / 2, halfH, seg.halfLength)
          .setTranslation(seg.center.x, seg.center.y - footY + halfH, seg.center.z)
          .setRotation({ x: 0, y: Math.sin(seg.yaw / 2), z: 0, w: Math.cos(seg.yaw / 2) })
          .setFriction(0.6),
      )
    }

    return road
  }
}

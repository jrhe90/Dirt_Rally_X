import * as THREE from 'three'
import type { BodyKind } from '../sim/types'
import { SPECS } from '../sim/traffic'

/**
 * Procedural cars. Each body is lofted from superellipse cross-sections along its length, from
 * curves for the underside, the deck (bonnet, beltline, boot) and the plan width; the underside
 * rises into arches over the wheels. The greenhouse is a second, narrower loft in tinted glass
 * with a body-coloured roof panel over it. Car-local axes: +x forward, +y up, +z right; the
 * origin is on the road under the center of the car.
 */

type Curve = [number, number][]

function along(points: Curve, x: number): number {
  if (x >= points[0][0]) return points[0][1]
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    if (x <= x0 && x >= x1) {
      const t = (x - x0) / (x1 - x0)
      const s = t * t * (3 - 2 * t)
      return y0 + (y1 - y0) * (0.5 * t + 0.5 * s)
    }
  }
  return points[points.length - 1][1]
}

export type Design = {
  /** Curves use x normalized to the half-length: +1 nose, -1 tail. */
  deck: Curve
  width: Curve
  bottom: number
  cabin: [number, number]
  roof: Curve
  /** Glass half-width as a fraction of the body at the beltline and at the roof. */
  glass: [number, number]
  exponent: number
  axles: [number, number]
  wheel: number
  /** Box truck: cargo body from this normalized x to the tail. */
  cargo?: number
}

export const DESIGNS: Record<BodyKind, Design> = {
  sedan: {
    deck: [[1, 0.6], [0.82, 0.78], [0.55, 0.88], [0.36, 0.94], [-0.55, 0.98], [-0.8, 1.0], [-1, 0.9]],
    width: [[1, 0.84], [0.8, 0.98], [0.2, 1.0], [-0.7, 1.0], [-1, 0.88]],
    bottom: 0.26,
    cabin: [0.38, -0.6],
    roof: [[0.38, 0.95], [0.12, 1.38], [-0.12, 1.45], [-0.36, 1.38], [-0.6, 1.0]],
    glass: [0.9, 0.7],
    exponent: 4,
    axles: [0.62, -0.62],
    wheel: 0.33,
  },
  hatch: {
    deck: [[1, 0.62], [0.8, 0.82], [0.5, 0.92], [0.34, 0.97], [-0.9, 1.02], [-1, 0.95]],
    width: [[1, 0.84], [0.75, 0.98], [0, 1.0], [-0.85, 0.98], [-1, 0.9]],
    bottom: 0.27,
    cabin: [0.36, -0.95],
    roof: [[0.36, 0.98], [0.1, 1.44], [-0.6, 1.5], [-0.88, 1.42], [-0.95, 1.04]],
    glass: [0.9, 0.74],
    exponent: 4,
    axles: [0.66, -0.66],
    wheel: 0.32,
  },
  suv: {
    deck: [[1, 0.78], [0.85, 1.0], [0.55, 1.1], [0.36, 1.14], [-0.9, 1.18], [-1, 1.1]],
    width: [[1, 0.88], [0.78, 1.0], [-0.8, 1.0], [-1, 0.92]],
    bottom: 0.36,
    cabin: [0.36, -0.94],
    roof: [[0.36, 1.16], [0.14, 1.68], [-0.75, 1.75], [-0.94, 1.66]],
    glass: [0.9, 0.8],
    exponent: 5,
    axles: [0.64, -0.64],
    wheel: 0.38,
  },
  van: {
    deck: [[1, 0.82], [0.85, 1.06], [0.62, 1.18], [-1, 1.22]],
    width: [[1, 0.88], [0.8, 0.98], [-1, 1.0]],
    bottom: 0.34,
    cabin: [0.62, -0.98],
    roof: [[0.62, 1.2], [0.4, 1.9], [0.25, 2.04], [-0.98, 2.04]],
    glass: [0.94, 0.88],
    exponent: 6,
    axles: [0.66, -0.66],
    wheel: 0.35,
  },
  truck: {
    deck: [[1, 1.0], [0.9, 1.4], [0.6, 1.5], [-1, 1.5]],
    width: [[1, 0.92], [0.9, 1.0], [-1, 1.0]],
    bottom: 0.55,
    cabin: [0.92, 0.6],
    roof: [[0.92, 1.5], [0.82, 2.5], [0.6, 2.75]],
    glass: [0.95, 0.9],
    exponent: 7,
    axles: [0.74, -0.62],
    wheel: 0.5,
    cargo: 0.56,
  },
  sports: {
    deck: [[1, 0.46], [0.75, 0.66], [0.4, 0.74], [-0.4, 0.8], [-0.82, 0.86], [-1, 0.78]],
    width: [[1, 0.84], [0.7, 1.0], [0.1, 0.94], [-0.6, 1.0], [-1, 0.9]],
    bottom: 0.18,
    cabin: [0.32, -0.62],
    roof: [[0.32, 0.76], [0.05, 1.16], [-0.18, 1.22], [-0.62, 0.85]],
    glass: [0.82, 0.6],
    exponent: 3.4,
    axles: [0.62, -0.62],
    wheel: 0.34,
  },
  cop: {
    deck: [[1, 0.62], [0.82, 0.8], [0.55, 0.9], [0.36, 0.96], [-0.55, 1.0], [-0.8, 1.02], [-1, 0.92]],
    width: [[1, 0.84], [0.8, 0.98], [0.2, 1.0], [-0.7, 1.0], [-1, 0.88]],
    bottom: 0.25,
    cabin: [0.36, -0.6],
    roof: [[0.36, 0.97], [0.12, 1.4], [-0.12, 1.46], [-0.36, 1.4], [-0.6, 1.02]],
    glass: [0.9, 0.7],
    exponent: 4,
    axles: [0.62, -0.62],
    wheel: 0.34,
  },
  ego: {
    // A low electric fastback: short bonnet, glass roof, long tail with a lip.
    deck: [[1, 0.56], [0.84, 0.72], [0.55, 0.82], [0.38, 0.88], [-0.6, 0.94], [-0.86, 0.98], [-0.95, 1.01], [-1, 0.93]],
    width: [[1, 0.86], [0.78, 1.0], [0.2, 0.97], [-0.62, 1.0], [-1, 0.9]],
    bottom: 0.2,
    cabin: [0.4, -0.88],
    roof: [[0.4, 0.9], [0.14, 1.34], [-0.08, 1.42], [-0.35, 1.36], [-0.88, 0.98]],
    glass: [0.86, 0.64],
    exponent: 4.6,
    axles: [0.6, -0.6],
    wheel: 0.35,
  },
}

const RING = 26

/** Loft a closed body; `sample(xn)` gives (half-width, bottom, top) at normalized x. */
function loft(
  halfLength: number,
  stations: number[],
  sample: (xn: number) => [number, number, number],
  exponent: number,
  tumble: number,
  color?: (x: number, y: number, z: number) => [number, number, number],
): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const rings: number[][] = []
  const e = 2 / exponent
  const pushV = (x: number, y: number, z: number) => {
    pos.push(x, y, z)
    const c = color ? color(x, y, z) : [1, 1, 1]
    col.push(c[0], c[1], c[2])
    return pos.length / 3 - 1
  }
  for (const xn of stations) {
    const [w, yb, yt] = sample(xn)
    const x = xn * halfLength
    const yc = (yb + yt) / 2
    const h = Math.max(0.01, (yt - yb) / 2)
    const ring: number[] = []
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * Math.PI * 2 - Math.PI / 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      let z = w * Math.sign(c) * Math.abs(c) ** e
      const y = yc + h * Math.sign(s) * Math.abs(s) ** e
      z *= 1 - tumble * Math.max(0, s) ** 1.5
      ring.push(pushV(x, y, z))
    }
    rings.push(ring)
  }
  const idx: number[] = []
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r]
    const B = rings[r + 1]
    for (let k = 0; k < RING; k++) {
      const k1 = (k + 1) % RING
      idx.push(A[k], A[k1], B[k], A[k1], B[k1], B[k])
    }
  }
  // Caps with their own vertices so the nose and tail stay crisp.
  for (const [ring, front] of [
    [rings[0], true],
    [rings[rings.length - 1], false],
  ] as const) {
    const c = new THREE.Vector3()
    for (const i of ring) c.add(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))
    c.divideScalar(ring.length)
    const center = pushV(c.x, c.y, c.z)
    const copy = ring.map((i) => pushV(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))
    for (let k = 0; k < RING; k++) {
      const k1 = (k + 1) % RING
      if (front) idx.push(center, copy[k1], copy[k])
      else idx.push(center, copy[k], copy[k1])
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function stationsFor(axles: [number, number], wheelN: number, from = 1, to = -1): number[] {
  const list: number[] = []
  for (let i = 0; i <= 34; i++) list.push(from + ((to - from) * i) / 34)
  for (const a of axles) for (let k = -6; k <= 6; k++) list.push(a + (k / 6) * wheelN * 1.15)
  return [...new Set(list.map((x) => Math.round(x * 1000) / 1000))].filter((x) => x <= from && x >= to).sort((a, b) => b - a)
}

export type CarParts = {
  body: THREE.BufferGeometry
  glass: THREE.BufferGeometry
  roof: THREE.BufferGeometry | null
  trim: THREE.BufferGeometry
  head: THREE.BufferGeometry
  tail: THREE.BufferGeometry
  indicatorL: THREE.BufferGeometry
  indicatorR: THREE.BufferGeometry
  lightbar: [THREE.BufferGeometry, THREE.BufferGeometry] | null
  wheels: { x: number; z: number; r: number; front: boolean }[]
  length: number
  width: number
  height: number
}

const cache = new Map<BodyKind, CarParts>()

function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz).toNonIndexed()
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k)
    return n
  })
  // Inline merge (avoids pulling attribute mismatches into BufferGeometryUtils).
  let count = 0
  for (const g of clean) count += g.attributes.position.count
  const p = new Float32Array(count * 3)
  const nrm = new Float32Array(count * 3)
  let o = 0
  for (const g of clean) {
    if (!g.attributes.normal) g.computeVertexNormals()
    p.set(g.attributes.position.array as Float32Array, o * 3)
    nrm.set(g.attributes.normal.array as Float32Array, o * 3)
    o += g.attributes.position.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(p, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  return out
}

export function carParts(kind: BodyKind): CarParts {
  const hit = cache.get(kind)
  if (hit) return hit
  const spec = SPECS[kind]
  const dz = DESIGNS[kind]
  const L = kind === 'ego' ? 4.97 : spec.length
  const W = kind === 'ego' ? 1.96 : spec.width
  const hl = L / 2
  const hw = W / 2
  const r = dz.wheel
  const wheelN = r / hl
  const arch = (xn: number) => {
    let b = dz.bottom
    for (const a of dz.axles) {
      const t = (xn - a) / (wheelN * 1.18)
      if (Math.abs(t) < 1) b = Math.max(b, r + r * 1.08 * Math.sqrt(1 - t * t) * 0.92)
    }
    return b
  }
  const bodyEnd = dz.cargo ?? -1
  const isCop = kind === 'cop'
  const paintColor = (x: number, y: number): [number, number, number] => {
    const xn = x / hl
    // Black lower fascia, sills and rear diffuser.
    if (xn < -0.88 && y < dz.bottom + 0.22) return [0.03, 0.03, 0.03]
    if (xn > 0.9 && y < dz.bottom + 0.12) return [0.04, 0.04, 0.04]
    if (y < dz.bottom + 0.04) return [0.06, 0.06, 0.06]
    if (isCop) {
      // Black-and-white: white doors, black nose, tail and roof line.
      const door = xn < 0.42 && xn > -0.5 && y < along(dz.deck, xn) - 0.04
      return door ? [1, 1, 1] : [0.035, 0.035, 0.04]
    }
    return [1, 1, 1]
  }
  const body = loft(
    hl,
    stationsFor(dz.axles, wheelN, 1, bodyEnd),
    (xn) => [hw * along(dz.width, xn), arch(xn), along(dz.deck, xn)],
    dz.exponent,
    0.1,
    (x, y) => paintColor(x, y),
  )
  const [c0, c1] = dz.cabin
  const cabinStations: number[] = []
  for (let i = 0; i <= 16; i++) cabinStations.push(c0 + ((c1 - c0) * i) / 16)
  const glass = loft(
    hl,
    cabinStations,
    (xn) => {
      const base = along(dz.deck, xn) - 0.03
      return [hw * along(dz.width, xn) * dz.glass[0], base - 0.05, Math.max(base + 0.02, along(dz.roof, xn))]
    },
    3,
    1 - dz.glass[1] / dz.glass[0],
  )
  // Body-coloured roof panel over the middle of the glasshouse.
  let roof: THREE.BufferGeometry | null = null
  if (kind !== 'ego') {
    const span = c0 - c1
    const r0 = c0 - span * 0.22
    const r1 = c1 + span * (kind === 'van' || kind === 'suv' || kind === 'hatch' ? 0.04 : 0.24)
    const rs: number[] = []
    for (let i = 0; i <= 10; i++) rs.push(r0 + ((r1 - r0) * i) / 10)
    roof = loft(
      hl,
      rs,
      (xn) => {
        const top = along(dz.roof, xn)
        return [hw * along(dz.width, xn) * dz.glass[1] * 0.98, top - 0.06, top + 0.012]
      },
      5,
      0.05,
      () => (isCop ? [0.035, 0.035, 0.04] : [1, 1, 1]),
    )
  }
  const trimList: THREE.BufferGeometry[] = []
  // Mirrors.
  const mx = c0 * hl - 0.15
  const my = along(dz.deck, c0 - 0.05) + 0.05
  for (const s of [-1, 1]) trimList.push(box(mx, my, s * (hw * along(dz.width, c0) + 0.08), 0.18, 0.12, 0.16))
  // Grille / intake.
  trimList.push(box(hl - 0.02, dz.bottom + 0.16, 0, 0.05, 0.18, W * 0.62))
  if (kind === 'ego') {
    // Rear lip spoiler.
    trimList.push(box(-hl + 0.18, along(dz.deck, -0.95) + 0.02, 0, 0.28, 0.03, W * 0.84))
  }
  if (dz.cargo === undefined) {
    // Number plate recess at the back.
    trimList.push(box(-hl + 0.01, dz.bottom + 0.3, 0, 0.04, 0.16, 0.52))
  }
  if (dz.cargo !== undefined) {
    // Box body for the truck.
    const x0 = dz.cargo * hl - 0.12
    const len = x0 + hl
    trimList.push(box(x0 - len / 2, (0.62 + 3.45) / 2, 0, len, 3.45 - 0.62, W))
  }

  // Lights.
  const frontX = hl - 0.06
  const headY = along(dz.deck, 0.92) - 0.07
  const head = merge([-1, 1].map((s) => box(frontX - 0.03, headY, s * (hw * 0.72), 0.14, 0.07, hw * 0.42)))
  const tailX = (dz.cargo !== undefined ? -1 : -0.995) * hl
  const tailY = dz.cargo !== undefined ? 0.95 : along(dz.deck, -0.96) - 0.08
  const tail =
    kind === 'ego' || kind === 'sports'
      ? merge([box(tailX, tailY, 0, 0.06, 0.05, W * 0.86)])
      : merge([-1, 1].map((s) => box(tailX, tailY, s * hw * 0.74, 0.06, 0.11, hw * 0.42)))
  const ind = (s: number) => merge([box(frontX - 0.05, headY - 0.06, s * hw * 0.9, 0.1, 0.05, 0.12), box(tailX, tailY - 0.1, s * hw * 0.88, 0.06, 0.05, 0.14)])
  let lightbar: [THREE.BufferGeometry, THREE.BufferGeometry] | null = null
  if (isCop) {
    const ry = along(dz.roof, -0.05) + 0.06
    lightbar = [box(-0.1, ry, -0.32, 0.26, 0.1, 0.58), box(-0.1, ry, 0.32, 0.26, 0.1, 0.58)]
    trimList.push(box(-0.1, ry - 0.05, 0, 0.3, 0.05, 1.3))
    // Push bar.
    trimList.push(box(hl + 0.06, dz.bottom + 0.28, 0, 0.08, 0.36, W * 0.7))
  }

  const wheels: CarParts['wheels'] = []
  const trackZ = hw - 0.17
  for (const a of dz.axles) {
    for (const s of [-1, 1]) wheels.push({ x: a * hl, z: s * trackZ, r, front: a > 0 })
  }
  if (dz.cargo !== undefined) for (const s of [-1, 1]) wheels.push({ x: (dz.axles[1] - 0.16) * hl, z: s * trackZ, r, front: false })

  const height = Math.max(...dz.roof.map((p) => p[1]))
  const parts: CarParts = {
    body,
    glass,
    roof,
    trim: merge(trimList),
    head,
    tail,
    indicatorL: ind(-1),
    indicatorR: ind(1),
    lightbar,
    wheels,
    length: L,
    width: W,
    height: dz.cargo !== undefined ? 3.45 : height,
  }
  cache.set(kind, parts)
  return parts
}

let wheelGeo: { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry } | null = null
export function wheelGeometry(): { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  if (wheelGeo) return wheelGeo
  const tire = new THREE.CylinderGeometry(1, 1, 0.24, 22).rotateX(Math.PI / 2)
  const rimParts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.68, 0.68, 0.03, 22).rotateX(Math.PI / 2).translate(0, 0, 0.115)]
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.BoxGeometry(0.14, 0.62, 0.04).translate(0, 0.33, 0.13)
    spoke.rotateZ((i / 5) * Math.PI * 2)
    rimParts.push(spoke)
  }
  rimParts.push(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10).rotateX(Math.PI / 2).translate(0, 0, 0.14))
  wheelGeo = { tire, rim: merge(rimParts) }
  return wheelGeo
}

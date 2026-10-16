import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { glow, Kit, type Materials } from './kit'

/**
 * A wedge hypercar roadster: low flat bonnet between two pointed fender peaks with triangular
 * headlights, a full-width front light bar over a black fascia, a black glass canopy that
 * tapers back over the rear deck, wide rear haunches, a flat full-width rear blade with red
 * light bars, and a black diffuser with four round nozzles. Car-local axes: +x forward, +y up,
 * +z to the right; origin at the sim's body center (the road is 0.62 m below). For flight the
 * wheels fold flat and the jets fire from their hubs; the rear nozzles glow with them.
 */

const FRONT = 2.2
const REAR = -2.2
export const AXLE_X = 1.38
export const TRACK_Z = 0.86
export const WHEEL_Y = -0.26
export const WHEEL_RADIUS = 0.36
const ARCH_RADIUS = 0.42

const PEARL = [0.84, 0.85, 0.87] as const
const BLACK = [0.03, 0.032, 0.036] as const
const TRIM = [0.012, 0.013, 0.015] as const

type Curve = [number, number][]

/** Piecewise-linear lookup along x; `points` run from front (+x) to rear. */
function along(points: Curve, x: number): number {
  if (x >= points[0][0]) return points[0][1]
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    if (x <= x0 && x >= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return points[points.length - 1][1]
}

/** Side crease along the top of the flanks: high fender peaks at the front, wide haunches at the back. */
const SHOULDER: Curve = [
  [2.2, 0.14], [2.0, 0.16], [1.6, 0.19], [1.2, 0.2], [0.8, 0.18], [0.2, 0.19], [-0.6, 0.22], [-1.4, 0.27], [-2.0, 0.28], [-2.2, 0.28],
]
/** Centerline: the flat bonnet, then the deck under the canopy and the rear deck. */
const DECK: Curve = [
  [2.2, -0.05], [1.6, 0.01], [0.85, 0.11], [-0.2, 0.16], [-1.75, 0.255], [-2.2, 0.265],
]
const HALF_WIDTH: Curve = [
  [2.2, 0.86], [2.08, 0.93], [1.7, 0.96], [1.38, 0.99], [0.9, 0.95], [0.2, 0.93], [-0.6, 0.96], [-1.38, 1.02], [-1.9, 1.0], [-2.2, 0.97],
]
/** Top of the black lower bodywork: low along the sills, rising into the nose and the rear quarters. */
const SILL: Curve = [
  [2.2, -0.1], [1.85, -0.3], [-0.7, -0.31], [-1.6, -0.18], [-2.2, -0.02],
]

const CANOPY_WIDTH: Curve = [
  [0.88, 0.72], [0.4, 0.77], [-0.4, 0.75], [-1.1, 0.6], [-1.8, 0.3],
]
const CANOPY_TOP: Curve = [
  [0.88, 0.11], [0.55, 0.26], [0.15, 0.43], [-0.2, 0.5], [-0.75, 0.5], [-1.25, 0.41], [-1.8, 0.255],
]
const CANOPY_FRONT = 0.88
const CANOPY_REAR = -1.8

function bottomY(x: number): number {
  if (x > 1.9) return -0.47 + 0.11 * ((x - 1.9) / 0.3) ** 2
  if (x < -1.95) return -0.47 + 0.1 * ((-1.95 - x) / 0.25) ** 2
  return -0.47
}

function archTop(x: number): number {
  let top = -Infinity
  for (const axle of [AXLE_X, -AXLE_X]) {
    const d = Math.abs(x - axle)
    if (d < ARCH_RADIUS) top = Math.max(top, WHEEL_Y + Math.sqrt(ARCH_RADIUS * ARCH_RADIUS - d * d))
  }
  return top
}

type Point = { z: number; y: number; color: readonly number[] }

/** Right half of a body cross-section, bottom center to top center (fixed point count). */
function bodySection(x: number): Point[] {
  const w = along(HALF_WIDTH, x)
  const yb = bottomY(x)
  const sh = along(SHOULDER, x)
  const deck = along(DECK, x)
  const arch = Math.max(yb, archTop(x))
  const flankBottom = Math.min(sh - 0.1, Math.max(arch + 0.035, along(SILL, x)))
  // How far the fender stands above the bonnet: a steep inner wall at the front, flat at the back.
  const fender = THREE.MathUtils.clamp((sh - deck) / 0.15, 0, 1)
  const inner = w - 0.1 - 0.16 * fender
  return [
    { z: 0, y: yb, color: TRIM },
    { z: 0.55, y: yb, color: TRIM },
    { z: 0.6, y: arch, color: TRIM },
    { z: w - 0.05, y: arch, color: BLACK },
    { z: w, y: flankBottom, color: BLACK },
    { z: w, y: flankBottom + 0.003, color: PEARL },
    { z: w + 0.018, y: (flankBottom + sh) / 2, color: PEARL },
    { z: w - 0.008, y: sh - 0.045, color: PEARL },
    { z: w - 0.05, y: sh, color: PEARL },
    { z: inner, y: deck + 0.004, color: PEARL },
    { z: inner * 0.5, y: deck + 0.008, color: PEARL },
    { z: 0, y: deck + 0.01, color: PEARL },
  ]
}

/** Right half of the canopy cross-section, from its base on the deck to the roof centerline. */
function canopySection(x: number): Point[] {
  const wc = along(CANOPY_WIDTH, x)
  const base = along(DECK, x) - 0.005
  const h = Math.max(0, along(CANOPY_TOP, x) - base)
  // Flat, steep side glass meeting a nearly flat roof at a crisp edge.
  return [
    { z: wc, y: base, color: TRIM },
    { z: wc * 0.96, y: base + h * 0.55, color: TRIM },
    { z: wc * 0.86, y: base + h * 0.93, color: TRIM },
    { z: wc * 0.62, y: base + h * 0.995, color: TRIM },
    { z: 0, y: base + h + 0.01, color: TRIM },
  ]
}

/** Loft mirrored half-sections along x into one closed-ish shell; optionally cap both ends. */
function loft(xs: number[], section: (x: number) => Point[], caps: boolean): THREE.BufferGeometry {
  const rings = xs.map((x) => {
    const right = section(x)
    const left = right.slice(1, -1).reverse().map((p) => ({ ...p, z: -p.z }))
    return { x, points: [...right, ...left] }
  })
  const size = rings[0].points.length
  const positions: number[] = []
  const colors: number[] = []
  for (const ring of rings) {
    for (const p of ring.points) {
      positions.push(ring.x, p.y, p.z)
      colors.push(...p.color)
    }
  }
  const index: number[] = []
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < size; j++) {
      const a = i * size + j
      const b = (i + 1) * size + j
      const c = (i + 1) * size + ((j + 1) % size)
      const d = i * size + ((j + 1) % size)
      index.push(a, b, d, b, c, d)
    }
  }
  if (caps) {
    for (const i of [0, rings.length - 1]) {
      const center = positions.length / 3
      const ring = rings[i]
      const cy = ring.points.reduce((s, p) => s + p.y, 0) / size
      positions.push(ring.x, cy, 0)
      colors.push(...PEARL)
      for (let j = 0; j < size; j++) {
        const a = i * size + j
        const b = i * size + ((j + 1) % size)
        // Wound both ways so the cap shows from either side.
        index.push(center, a, b, center, b, a)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setIndex(index)
  // Smooth panels with sharp creases at the shoulders, sills and arch lips.
  return toCreasedNormals(g, Math.PI / 5)
}

function bodyStations(): number[] {
  const xs: number[] = []
  for (let x = REAR; x <= FRONT + 1e-6; x += 0.04) xs.push(Math.min(x, FRONT))
  for (const axle of [AXLE_X, -AXLE_X]) for (let a = -1; a <= 1; a += 0.1) xs.push(axle + a * ARCH_RADIUS)
  if (xs[xs.length - 1] !== FRONT) xs.push(FRONT)
  return [...new Set(xs.map((x) => Math.round(x * 10000) / 10000))].filter((x) => x >= REAR && x <= FRONT).sort((a, b) => a - b)
}

function canopyStations(): number[] {
  const xs: number[] = []
  for (let x = CANOPY_REAR; x <= CANOPY_FRONT + 1e-6; x += 0.04) xs.push(Math.min(x, CANOPY_FRONT))
  return xs
}

/** Large wheel with a dark six-spoke turbine face; the hub doubles as the jet nozzle. */
function buildWheel(materials: Materials): { group: THREE.Group; spinner: THREE.Group; hub: THREE.Mesh } {
  const group = new THREE.Group()
  const spinner = new THREE.Group()
  group.add(spinner)
  const kit = new Kit()
  const tire = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.28, 32)
  tire.rotateX(Math.PI / 2)
  kit.add('matte', tire, [0.022, 0.022, 0.025])
  const sidewall = new THREE.TorusGeometry(WHEEL_RADIUS - 0.035, 0.035, 6, 32)
  sidewall.translate(0, 0, 0.13)
  kit.add('matte', sidewall, [0.03, 0.03, 0.033])
  const rim = new THREE.CylinderGeometry(0.255, 0.255, 0.02, 32)
  rim.rotateX(Math.PI / 2)
  rim.translate(0, 0, 0.13)
  kit.add('paint', rim, [0.02, 0.02, 0.024])
  const lip = new THREE.TorusGeometry(0.258, 0.012, 6, 32)
  lip.translate(0, 0, 0.142)
  kit.add('paint', lip, [0.3, 0.31, 0.33])
  for (let i = 0; i < 6; i++) {
    // Swept spokes: each one is twisted a little so the face reads as a turbine.
    const spoke = new THREE.BoxGeometry(0.06, 0.2, 0.025)
    spoke.translate(0, 0.14, 0)
    spoke.rotateZ(0.35)
    spoke.translate(0, 0, 0.15)
    spoke.rotateZ((i / 6) * Math.PI * 2)
    kit.add('paint', spoke, [0.11, 0.115, 0.125])
  }
  spinner.add(kit.build(materials))
  const hubGeometry = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 16)
  hubGeometry.rotateX(Math.PI / 2)
  hubGeometry.translate(0, 0, 0.16)
  const hub = new THREE.Mesh(hubGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.06, 0.07) }))
  group.add(hub)
  return { group, spinner, hub }
}

/** Thin white edge from the fender peak up the A-pillar, along the canopy's front corner. */
function pillarTrim(side: 1 | -1): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [new THREE.Vector3(1.95, along(SHOULDER, 1.95) - 0.01, side * (along(HALF_WIDTH, 1.95) - 0.16))]
  for (let x = CANOPY_FRONT; x >= -0.35; x -= 0.08) {
    const s = canopySection(x)[2]
    points.push(new THREE.Vector3(x, s.y + 0.004, side * (s.z + 0.006)))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.011, 5)
}

export type Roadster = {
  root: THREE.Group
  /** Pitch and roll are applied here. */
  body: THREE.Group
  wheels: { pivot: THREE.Group; spinner: THREE.Group; hub: THREE.Mesh; side: 1 | -1; x: number }[]
  /** Jet nozzle positions in body space (where the flames start). */
  nozzles: THREE.Vector3[]
  /** The four round rear nozzles in the diffuser. */
  rearGlow: THREE.MeshBasicMaterial
}

export function createRoadster(materials: Materials): Roadster {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.rotation.order = 'ZXY'
  root.add(body)
  const envMap = (materials.paint as THREE.MeshStandardMaterial).envMap

  const shell = new THREE.Mesh(
    loft(bodyStations(), bodySection, true),
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMap,
      envMapIntensity: 1.1,
    }),
  )
  const canopy = new THREE.Mesh(
    loft(canopyStations(), canopySection, false),
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.04,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMap,
      envMapIntensity: 1.6,
    }),
  )
  body.add(shell, canopy)

  const kit = new Kit()
  const fw = along(HALF_WIDTH, FRONT)

  // Front: black fascia under a full-width white light bar.
  kit.box('matte', FRONT - 0.09, FRONT + 0.012, -0.4, -0.085, -fw + 0.02, fw - 0.02, TRIM)
  kit.box('glow', FRONT - 0.02, FRONT + 0.02, -0.085, -0.058, -fw + 0.03, fw - 0.03, glow([0.9, 0.95, 1], 4.5))
  kit.box('matte', FRONT - 0.3, FRONT + 0.03, -0.47, -0.42, -fw + 0.06, fw - 0.06, TRIM)
  // Triangular headlights on the faces of the fender peaks, pointing down and inward.
  for (const s of [1, -1]) {
    const tri = new THREE.BufferGeometry()
    const x = FRONT + 0.016
    tri.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([x, 0.105, s * 0.58, x, 0.105, s * 0.8, x, 0.0, s * 0.64, x, 0.105, s * 0.58, x, 0.0, s * 0.64, x, 0.105, s * 0.8], 3),
    )
    tri.computeVertexNormals()
    kit.add('glow', tri, glow([0.92, 0.96, 1], 9))
    kit.add('glow', pillarTrim(s as 1 | -1), glow([0.9, 0.92, 0.95], 0.55))
    // Mirrors on short stalks at the base of the A-pillars.
    kit.box('paint', 0.68, 0.84, 0.19, 0.26, s * 0.93, s * 1.06, TRIM)
    kit.box('paint', 0.72, 0.78, 0.15, 0.19, s * 0.86, s * 0.95, TRIM)
  }

  // Rear: flat full-width blade with a red edge light, a main red bar below it, black diffuser.
  const rw = along(HALF_WIDTH, REAR)
  kit.hexa(
    'paint',
    [
      [-2.36, 0.268, -rw - 0.07], [-1.92, 0.272, -rw - 0.02], [-1.92, 0.272, rw + 0.02], [-2.36, 0.268, rw + 0.07],
      [-2.36, 0.305, -rw - 0.07], [-1.92, 0.3, -rw - 0.02], [-1.92, 0.3, rw + 0.02], [-2.36, 0.305, rw + 0.07],
    ],
    PEARL,
  )
  kit.box('glow', -2.37, -2.345, 0.274, 0.29, -rw + 0.08, rw - 0.08, glow([1, 0.04, 0.03], 4))
  // Main tail-light bar in a thin black slot just under the blade, then a white tail panel.
  kit.box('paint', REAR - 0.006, REAR + 0.02, 0.155, 0.245, -0.86, 0.86, TRIM)
  kit.box('glow', REAR - 0.014, REAR + 0.01, 0.18, 0.22, -0.82, 0.82, glow([1, 0.03, 0.02], 6))
  kit.box('paint', REAR - 0.012, REAR + 0.02, -0.08, 0.15, -0.62, 0.62, PEARL)
  // Black diffuser across the bottom with short vertical strakes.
  kit.box('paint', REAR - 0.07, REAR + 0.3, -0.46, -0.1, -rw + 0.04, rw - 0.04, TRIM)
  for (const z of [-0.78, -0.39, 0, 0.39, 0.78]) kit.box('matte', REAR - 0.09, REAR + 0.3, -0.46, -0.36, z - 0.012, z + 0.012, BLACK)
  const nozzleGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.04, 0.045, 0.05) })
  const nozzleFace = new THREE.CylinderGeometry(0.07, 0.07, 0.01, 20)
  nozzleFace.rotateZ(Math.PI / 2)
  for (const z of [-0.58, -0.2, 0.2, 0.58]) {
    const ring = new THREE.CylinderGeometry(0.095, 0.095, 0.06, 24, 1, true)
    ring.rotateZ(Math.PI / 2)
    ring.translate(REAR - 0.09, -0.27, z)
    kit.add('paint', ring, [0.28, 0.27, 0.25])
    const face = new THREE.Mesh(nozzleFace, nozzleGlow)
    face.position.set(REAR - 0.075, -0.27, z)
    body.add(face)
  }
  // Small red side markers on the rear quarters.
  for (const s of [1, -1]) kit.box('glow', -1.95, -1.9, -0.06, -0.03, s * (along(HALF_WIDTH, -1.92) + 0.005), s * (along(HALF_WIDTH, -1.92) + 0.012), glow([1, 0.05, 0.03], 4))
  body.add(kit.build(materials))

  const wheels: Roadster['wheels'] = []
  const nozzles: THREE.Vector3[] = []
  for (const x of [AXLE_X, -AXLE_X]) {
    for (const side of [1, -1] as const) {
      const { group, spinner, hub } = buildWheel(materials)
      const pivot = new THREE.Group()
      pivot.position.set(x, WHEEL_Y, side * TRACK_Z)
      // Left wheels face outward too.
      if (side < 0) group.rotation.y = Math.PI
      pivot.add(group)
      body.add(pivot)
      wheels.push({ pivot, spinner, hub, side, x })
      nozzles.push(new THREE.Vector3(x, WHEEL_Y - 0.12, side * TRACK_Z))
    }
  }

  return { root, body, wheels, nozzles, rearGlow: nozzleGlow }
}

/**
 * Pose the car: 0 = driving, 1 = flight (wheels folded flat, hubs facing down).
 * Pitch and roll come from the sim.
 */
export function poseRoadster(car: Roadster, flight: number, pitch: number, roll: number, wheelSpin: number, jet: number): void {
  car.body.rotation.set(roll, 0, pitch, 'ZXY')
  for (const w of car.wheels) {
    w.pivot.rotation.x = w.side * flight * Math.PI * 0.5
    w.pivot.position.y = WHEEL_Y + flight * 0.08
    w.pivot.position.z = w.side * (TRACK_Z - flight * 0.05)
    w.spinner.rotation.z = -wheelSpin * w.side
    const hub = w.hub.material as THREE.MeshBasicMaterial
    hub.color.setRGB(0.05 + 2.2 * jet, 0.06 + 4 * jet, 0.07 + 5 * jet)
  }
  car.rearGlow.color.setRGB(0.04 + 1.6 * jet, 0.045 + 3.2 * jet, 0.05 + 4.5 * jet)
}

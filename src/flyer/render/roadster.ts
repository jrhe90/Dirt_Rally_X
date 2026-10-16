import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { glow, Kit, type Materials } from './kit'

/**
 * A wedge hypercar roadster. In profile: a sharp nose about 0.4 m off the road with the fender
 * line sweeping up from it, a beltline rising toward the rear, a roof peak over the doors and a
 * straight fastback down to a high cut-off tail. The bonnet sits low between pointed fender
 * peaks with triangular headlights, over a full-width light bar and black fascia; the
 * bronze-tinted canopy starts just behind the front wheels and tapers to a point at the rear
 * arches, with body-colour sails beside it; a thin black sill band rises into tall black rear
 * quarters; a flat rear blade carries the red light bars over a black diffuser with four round
 * nozzles. Proportions are taken from a side photo. Car-local axes: +x forward, +y up, +z to the right; origin at the sim's body center (the road is 0.62 m below). For flight the
 * wheels fold flat and the jets fire from their hubs; the rear nozzles glow with them.
 */

const FRONT = 2.2
const REAR = -2.2
const FRONT_AXLE = 1.41
const REAR_AXLE = -1.54
const AXLES = [FRONT_AXLE, REAR_AXLE]
export const TRACK_Z = 0.86
export const WHEEL_Y = -0.26
export const WHEEL_RADIUS = 0.36
const ARCH_RADIUS = 0.405

const PEARL = [0.84, 0.85, 0.87] as const
const BLACK = [0.03, 0.032, 0.036] as const
const TRIM = [0.012, 0.013, 0.015] as const
const BRONZE = [0.15, 0.095, 0.055] as const
const CHROME = [0.78, 0.78, 0.8] as const

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
  [2.2, -0.19], [2.05, -0.04], [1.8, 0.12], [1.55, 0.21], [1.25, 0.225], [0.9, 0.2], [0.2, 0.24], [-0.6, 0.3], [-1.2, 0.36], [-1.7, 0.3], [-2.2, 0.22],
]
/** Centerline: the low bonnet, the deck under the canopy, then the straight fastback to the tail. */
const DECK: Curve = [
  [2.2, -0.21], [1.95, -0.1], [1.6, 0.0], [1.15, 0.065], [0.4, 0.16], [-0.4, 0.24], [-1.25, 0.355], [-1.7, 0.29], [-2.2, 0.21],
]
const HALF_WIDTH: Curve = [
  [2.2, 0.86], [2.08, 0.93], [1.7, 0.96], [1.41, 0.99], [0.9, 0.95], [0.2, 0.93], [-0.6, 0.96], [-1.54, 1.02], [-1.95, 1.0], [-2.2, 0.97],
]
/** Top of the black lower bodywork: low along the sills, rising into the nose and the rear quarters. */
const SILL: Curve = [
  [2.2, -0.24], [1.95, -0.34], [1.0, -0.37], [-1.0, -0.26], [-1.55, -0.12], [-1.9, 0.0], [-2.2, 0.02],
]

/** In plan the canopy is a long teardrop: a straight windshield base, widest at the doors, a point at the back. */
const CANOPY_WIDTH: Curve = [
  [1.15, 0.64], [0.6, 0.76], [-0.2, 0.78], [-0.8, 0.6], [-1.27, 0.05],
]
const CANOPY_TOP: Curve = [
  [1.15, 0.065], [0.75, 0.3], [0.3, 0.48], [-0.1, 0.52], [-0.45, 0.52], [-0.85, 0.45], [-1.27, 0.355],
]
const CANOPY_FRONT = 1.15
const CANOPY_REAR = -1.27

function bottomY(x: number): number {
  if (x > 1.9) return -0.47 + 0.13 * ((x - 1.9) / 0.3) ** 2
  if (x < -1.95) return -0.47 + 0.1 * ((-1.95 - x) / 0.25) ** 2
  return -0.47
}

function archTop(x: number): number {
  let top = -Infinity
  for (const axle of AXLES) {
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
  const flankBottom = Math.max(arch + 0.02, Math.min(sh - 0.07, along(SILL, x)))
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
    { z: wc, y: base, color: BRONZE },
    { z: wc * 0.96, y: base + h * 0.55, color: BRONZE },
    { z: wc * 0.86, y: base + h * 0.93, color: BRONZE },
    { z: wc * 0.62, y: base + h * 0.995, color: BRONZE },
    { z: 0, y: base + h + 0.01, color: BRONZE },
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
  for (const axle of AXLES) for (let a = -1; a <= 1; a += 0.1) xs.push(axle + a * ARCH_RADIUS)
  if (xs[xs.length - 1] !== FRONT) xs.push(FRONT)
  return [...new Set(xs.map((x) => Math.round(x * 10000) / 10000))].filter((x) => x >= REAR && x <= FRONT).sort((a, b) => a - b)
}

function canopyStations(): number[] {
  const xs: number[] = []
  for (let x = CANOPY_REAR; x <= CANOPY_FRONT + 1e-6; x += 0.04) xs.push(Math.min(x, CANOPY_FRONT))
  return xs
}

/**
 * Large wheel: six bold black spokes over light aero inserts, like the reference car.
 * The hub doubles as the jet nozzle. `width` is the tyre width (the rears are wider).
 */
function buildWheel(materials: Materials, width: number): { group: THREE.Group; spinner: THREE.Group; hub: THREE.Mesh } {
  const group = new THREE.Group()
  const spinner = new THREE.Group()
  group.add(spinner)
  const kit = new Kit()
  const face = width / 2
  const tire = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, width, 32)
  tire.rotateX(Math.PI / 2)
  kit.add('matte', tire, [0.022, 0.022, 0.025])
  const sidewall = new THREE.TorusGeometry(WHEEL_RADIUS - 0.035, 0.035, 6, 32)
  sidewall.translate(0, 0, face - 0.01)
  kit.add('matte', sidewall, [0.03, 0.03, 0.033])
  const insert = new THREE.CylinderGeometry(0.262, 0.262, 0.02, 40)
  insert.rotateX(Math.PI / 2)
  insert.translate(0, 0, face + 0.002)
  kit.add('paint', insert, [0.62, 0.63, 0.66])
  const lip = new THREE.TorusGeometry(0.265, 0.014, 6, 40)
  lip.translate(0, 0, face + 0.01)
  kit.add('paint', lip, [0.02, 0.02, 0.024])
  for (let i = 0; i < 6; i++) {
    // Each spoke is two segments bent slightly against the rotation.
    const base = (i / 6) * Math.PI * 2
    for (const [r0, r1, bend] of [[0.06, 0.16, 0], [0.155, 0.262, 0.22]]) {
      const seg = new THREE.BoxGeometry(0.052, r1 - r0, 0.03)
      seg.translate(0, (r0 + r1) / 2, 0)
      seg.rotateZ(bend * ((r0 + r1) / 2 / 0.262))
      seg.translate(0, 0, face + 0.02)
      seg.rotateZ(base)
      kit.add('paint', seg, [0.015, 0.015, 0.018])
    }
  }
  const cap = new THREE.CylinderGeometry(0.075, 0.075, 0.025, 20)
  cap.rotateX(Math.PI / 2)
  cap.translate(0, 0, face + 0.02)
  kit.add('paint', cap, [0.015, 0.015, 0.018])
  spinner.add(kit.build(materials))
  const hubGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16)
  hubGeometry.rotateX(Math.PI / 2)
  hubGeometry.translate(0, 0, face + 0.034)
  const hub = new THREE.Mesh(hubGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.06, 0.07) }))
  group.add(hub)
  return { group, spinner, hub }
}

/** White body-colour rail from the fender peak up the A-pillar and along the roof edge, framing the side glass. */
function roofRail(side: 1 | -1): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [new THREE.Vector3(1.95, along(SHOULDER, 1.95) - 0.01, side * (along(HALF_WIDTH, 1.95) - 0.16))]
  for (let x = CANOPY_FRONT - 0.02; x >= -0.95; x -= 0.08) {
    const s = canopySection(x)[2]
    points.push(new THREE.Vector3(x, s.y + 0.006, side * (s.z + 0.008)))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.022, 6)
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
      metalness: 0.45,
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
  kit.box('matte', FRONT - 0.09, FRONT + 0.012, -0.36, -0.225, -fw + 0.02, fw - 0.02, TRIM)
  kit.box('glow', FRONT - 0.02, FRONT + 0.02, -0.225, -0.2, -fw + 0.03, fw - 0.03, glow([0.9, 0.95, 1], 4.5))
  kit.box('matte', FRONT - 0.45, FRONT + 0.04, -0.44, -0.38, -fw + 0.06, fw - 0.06, TRIM)
  // Triangular headlights on the sloping faces of the fender peaks, pointing forward and inward.
  for (const s of [1, -1]) {
    const tri = new THREE.BufferGeometry()
    const on = (x: number, z: number) => [x, along(SHOULDER, x) + 0.014, s * z]
    const a = on(2.1, 0.6)
    const b = on(2.1, 0.82)
    const c = on(1.93, 0.79)
    tri.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3))
    tri.computeVertexNormals()
    kit.add('glow', tri, glow([0.92, 0.96, 1], 9))
    kit.add('paint', roofRail(s as 1 | -1), PEARL)
    // Door shut lines: the front one nearly upright, the rear one leaning back.
    for (const [xb, xt] of [[0.84, 0.8], [-0.24, -0.42]]) {
      const yb = along(SILL, xb) + 0.02
      const yt = along(SHOULDER, xt) - 0.04
      const zb = s * (along(HALF_WIDTH, xb) + 0.016)
      const zt = s * (along(HALF_WIDTH, xt) + 0.006)
      kit.hexa(
        'matte',
        [
          [xb - 0.006, yb, zb], [xb + 0.006, yb, zb], [xb + 0.006, yb, zb + s * 0.006], [xb - 0.006, yb, zb + s * 0.006],
          [xt - 0.006, yt, zt], [xt + 0.006, yt, zt], [xt + 0.006, yt, zt + s * 0.006], [xt - 0.006, yt, zt + s * 0.006],
        ],
        TRIM,
      )
    }
    // Small black camera pods low at the base of the A-pillars.
    kit.box('paint', 0.94, 1.1, 0.05, 0.1, s * 0.9, s * 1.0, TRIM)
  }

  // Rear: flat full-width blade with a red edge light, a main red bar below it, black diffuser.
  const rw = along(HALF_WIDTH, REAR)
  kit.hexa(
    'paint',
    [
      [-2.34, 0.215, -rw - 0.06], [-1.95, 0.248, -rw - 0.02], [-1.95, 0.248, rw + 0.02], [-2.34, 0.215, rw + 0.06],
      [-2.34, 0.262, -rw - 0.06], [-1.95, 0.27, -rw - 0.02], [-1.95, 0.27, rw + 0.02], [-2.34, 0.262, rw + 0.06],
    ],
    PEARL,
  )
  kit.box('glow', -2.35, -2.33, 0.218, 0.236, -rw + 0.08, rw - 0.08, glow([1, 0.04, 0.03], 4))
  // Main tail-light bar in a thin black slot just under the blade, then a white tail panel with a blank plate.
  kit.box('paint', REAR - 0.006, REAR + 0.02, 0.1, 0.19, -0.86, 0.86, TRIM)
  kit.box('glow', REAR - 0.014, REAR + 0.01, 0.125, 0.165, -0.82, 0.82, glow([1, 0.03, 0.02], 6))
  kit.box('paint', REAR - 0.012, REAR + 0.02, -0.12, 0.1, -0.66, 0.66, PEARL)
  kit.box('matte', REAR - 0.025, REAR - 0.005, -0.07, 0.07, -0.17, 0.17, [0.75, 0.76, 0.78])
  for (const s of [1, -1]) kit.box('glow', REAR - 0.016, REAR + 0.01, -0.105, -0.09, s * 0.4, s * 0.62, glow([1, 0.04, 0.03], 3))
  // Black diffuser: a bar carrying four chrome nozzles, with strakes below.
  kit.box('paint', REAR - 0.07, REAR + 0.3, -0.46, -0.12, -rw + 0.04, rw - 0.04, TRIM)
  kit.box('paint', REAR - 0.1, REAR + 0.1, -0.35, -0.17, -0.74, 0.74, BLACK)
  for (const z of [-0.78, -0.39, 0, 0.39, 0.78]) kit.box('matte', REAR - 0.12, REAR + 0.3, -0.47, -0.35, z - 0.012, z + 0.012, BLACK)
  const nozzleGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.04, 0.045, 0.05) })
  const nozzleFace = new THREE.CylinderGeometry(0.058, 0.058, 0.01, 20)
  nozzleFace.rotateZ(Math.PI / 2)
  for (const z of [-0.54, -0.18, 0.18, 0.54]) {
    const tip = new THREE.CylinderGeometry(0.075, 0.075, 0.08, 24, 1, true)
    tip.rotateZ(Math.PI / 2)
    tip.translate(REAR - 0.13, -0.26, z)
    kit.add('glass', tip, CHROME)
    const face = new THREE.Mesh(nozzleFace, nozzleGlow)
    face.position.set(REAR - 0.12, -0.26, z)
    body.add(face)
  }
  // Small red side markers on the rear quarters.
  for (const s of [1, -1]) kit.box('glow', -2.06, -2.01, -0.06, -0.03, s * (along(HALF_WIDTH, -2.03) + 0.005), s * (along(HALF_WIDTH, -2.03) + 0.012), glow([1, 0.05, 0.03], 4))
  body.add(kit.build(materials))

  const wheels: Roadster['wheels'] = []
  const nozzles: THREE.Vector3[] = []
  for (const x of AXLES) {
    for (const side of [1, -1] as const) {
      const { group, spinner, hub } = buildWheel(materials, x > 0 ? 0.28 : 0.34)
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

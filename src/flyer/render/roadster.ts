import * as THREE from 'three'
import { glow, Kit, type Materials } from './kit'

/**
 * A fictional wedge roadster: long low nose, black glass canopy, fastback tail and full-width
 * light bars. Car-local axes: +x forward, +y up, +z to the right; origin at the sim's body
 * center (the road is 0.62 m below). The four wheels fold flat for flight and the jets fire
 * from their hubs.
 */

const FRONT = 2.2
const REAR = -2.2
export const AXLE_X = 1.38
export const TRACK_Z = 0.86
export const WHEEL_Y = -0.26
export const WHEEL_RADIUS = 0.36

const PEARL = [0.82, 0.84, 0.87] as const
const GLASS = [0.015, 0.017, 0.02] as const
const SKIRT = [0.035, 0.037, 0.04] as const

const TOP: [number, number][] = [
  [2.2, -0.1],
  [2.1, -0.02],
  [1.7, 0.08],
  [1.0, 0.16],
  [0.55, 0.33],
  [0.0, 0.5],
  [-0.45, 0.55],
  [-1.1, 0.5],
  [-1.7, 0.36],
  [-2.1, 0.25],
  [-2.2, 0.16],
]

function interpolate(points: [number, number][], x: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    if (x <= x0 && x >= x1) {
      const f = (x - x0) / (x1 - x0)
      const s = f * f * (3 - 2 * f)
      return y0 + (y1 - y0) * s
    }
  }
  return x > points[0][0] ? points[0][1] : points[points.length - 1][1]
}

const topY = (x: number) => interpolate(TOP, x)
const beltY = (x: number) => Math.min(topY(x), x > 1.0 ? -0.1 + (0.24 * (FRONT - x)) / (FRONT - 1.0) : 0.14 + (0.06 * (1.0 - x)) / (1.0 - REAR))

function bottomY(x: number): number {
  if (x > 1.75) return -0.47 + 0.2 * ((x - 1.75) / 0.45) ** 2
  if (x < -1.85) return -0.47 + 0.14 * ((-1.85 - x) / 0.35) ** 2
  return -0.47
}

function halfWidth(x: number): number {
  let w = 0.9
  if (x > 1.2) w -= 0.24 * ((x - 1.2) / 1.0) ** 2
  if (x < -1.6) w -= 0.1 * ((-1.6 - x) / 0.6) ** 2
  for (const axle of [AXLE_X, -AXLE_X]) {
    const d = Math.abs(x - axle) / 0.6
    if (d < 1) w += 0.06 * Math.cos(d * Math.PI * 0.5) ** 2
  }
  return w
}

/** Right half of a cross-section, bottom center to top center, with a colour per point. */
function section(x: number): { z: number; y: number; color: readonly number[] }[] {
  const w = halfWidth(x)
  const yb = bottomY(x)
  const top = topY(x)
  const belt = Math.max(yb + 0.12, beltY(x))
  const cabin = top - belt
  const glass = cabin > 0.05
  const canopyW = glass ? w * 0.72 : w * 0.45
  const pts: { z: number; y: number; color: readonly number[] }[] = [
    { z: 0, y: yb, color: SKIRT },
    { z: w - 0.1, y: yb, color: SKIRT },
    { z: w - 0.025, y: yb + 0.035, color: SKIRT },
    { z: w, y: Math.min(yb + 0.1, belt - 0.06), color: PEARL },
    { z: w + 0.005, y: (yb + belt) / 2, color: PEARL },
    { z: w, y: belt - 0.06, color: PEARL },
    { z: w - 0.035, y: belt - 0.012, color: PEARL },
    { z: w - 0.12, y: belt, color: PEARL },
  ]
  const steps = 6
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 0.5
    const n = 2.6
    const z = canopyW * Math.cos(theta) ** (2 / n)
    const y = belt + Math.max(0, cabin) * Math.sin(theta) ** (2 / n)
    pts.push({ z: Math.min(z, w - 0.12), y: i === 0 ? belt + 0.004 : y, color: glass && i > 0 ? GLASS : PEARL })
  }
  pts[pts.length - 1].z = 0
  return pts
}

function stations(): number[] {
  const xs: number[] = []
  for (let x = REAR; x <= FRONT + 1e-6; x += 0.08) xs.push(Math.min(x, FRONT))
  return xs
}

function buildBody(): THREE.BufferGeometry {
  const xs = stations()
  const rings = xs.map((x) => {
    const right = section(x)
    const left = right.slice(1, -1).reverse().map((p) => ({ ...p, z: -p.z }))
    return { x, points: [...right, ...left] }
  })
  const ringSize = rings[0].points.length
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
    for (let j = 0; j < ringSize; j++) {
      const a = i * ringSize + j
      const b = (i + 1) * ringSize + j
      const c = (i + 1) * ringSize + ((j + 1) % ringSize)
      const d = i * ringSize + ((j + 1) % ringSize)
      index.push(a, b, d, b, c, d)
    }
  }
  // Caps at both ends, wound both ways so they show from either side.
  for (const i of [0, rings.length - 1]) {
    const center = positions.length / 3
    const ring = rings[i]
    const cy = ring.points.reduce((s, p) => s + p.y, 0) / ringSize
    positions.push(ring.x, cy, 0)
    colors.push(...PEARL)
    for (let j = 0; j < ringSize; j++) {
      const a = i * ringSize + j
      const b = i * ringSize + ((j + 1) % ringSize)
      index.push(center, a, b, center, b, a)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

function buildWheel(materials: Materials): { group: THREE.Group; spinner: THREE.Group; hub: THREE.Mesh } {
  const group = new THREE.Group()
  const spinner = new THREE.Group()
  group.add(spinner)
  const kit = new Kit()
  const tire = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.26, 28)
  tire.rotateX(Math.PI / 2)
  kit.add('matte', tire, [0.025, 0.025, 0.028])
  const rim = new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24)
  rim.rotateX(Math.PI / 2)
  rim.translate(0, 0, 0.125)
  kit.add('paint', rim, [0.03, 0.03, 0.035])
  for (let i = 0; i < 6; i++) {
    const spoke = new THREE.BoxGeometry(0.05, 0.26, 0.03)
    spoke.translate(0, 0.13, 0.14)
    spoke.rotateZ((i / 6) * Math.PI * 2)
    kit.add('paint', spoke, [0.12, 0.12, 0.13])
  }
  spinner.add(kit.build(materials))
  // Jet nozzle in the hub: dark at rest, cyan when the jets fire.
  const hubMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.06, 0.07) })
  const hubGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16)
  hubGeometry.rotateX(Math.PI / 2)
  hubGeometry.translate(0, 0, 0.15)
  const hub = new THREE.Mesh(hubGeometry, hubMaterial)
  group.add(hub)
  return { group, spinner, hub }
}

export type Roadster = {
  root: THREE.Group
  /** Pitch and roll are applied here. */
  body: THREE.Group
  wheels: { pivot: THREE.Group; spinner: THREE.Group; hub: THREE.Mesh; side: 1 | -1; x: number }[]
  /** Jet nozzle positions in body space (where the flames start). */
  nozzles: THREE.Vector3[]
  tailLights: THREE.Mesh
}

export function createRoadster(materials: Materials): Roadster {
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.rotation.order = 'ZXY'
  root.add(body)

  const shell = new THREE.Mesh(
    buildBody(),
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.28,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMap: (materials.paint as THREE.MeshStandardMaterial).envMap,
      envMapIntensity: 1.1,
    }),
  )
  body.add(shell)

  const kit = new Kit()
  // Front light bar across the nose and lamps at its ends.
  kit.box('glow', 2.13, 2.19, -0.07, -0.04, -0.6, 0.6, glow([0.85, 0.92, 1], 3.5))
  kit.box('glow', 2.06, 2.15, -0.08, -0.03, 0.55, 0.72, glow([0.9, 0.95, 1], 6))
  kit.box('glow', 2.06, 2.15, -0.08, -0.03, -0.72, -0.55, glow([0.9, 0.95, 1], 6))
  // Underbody and diffuser.
  kit.box('matte', -2.05, 1.85, -0.5, -0.46, -0.7, 0.7, [0.02, 0.02, 0.02])
  kit.box('matte', -2.22, -1.95, -0.47, -0.3, -0.7, 0.7, [0.03, 0.03, 0.035])
  // Side air intakes behind the doors.
  for (const s of [1, -1]) kit.box('matte', -0.95, -0.55, -0.15, 0.05, s * 0.86, s * 0.93, [0.02, 0.02, 0.025])
  body.add(kit.build(materials))

  const tailKit = new Kit()
  tailKit.box('glow', -2.22, -2.16, 0.07, 0.12, -0.84, 0.84, glow([1, 0.04, 0.03], 5))
  const tail = tailKit.build(materials)
  body.add(tail)

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

  return { root, body, wheels, nozzles, tailLights: tail.children[0] as THREE.Mesh }
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
}

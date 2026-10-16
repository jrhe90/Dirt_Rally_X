import * as THREE from 'three'
import {
  BALL_RADIUS,
  CEILING_Y,
  CRANE_PIVOT_Y,
  DRONE_RADIUS,
  INTERCEPTOR_HALF,
  INTERCEPTOR_LOCK,
  INTERCEPTOR_WARN,
  OVERPASS_DECK,
  OVERPASS_HALF,
  TRUCK,
  WALL,
} from '../sim/config'
import { craneBall, LASER_HALF_THICKNESS } from '../sim/obstacles'
import type { Obstacle, ObstacleKind, SimState } from '../sim/types'
import { glow, Kit, type Materials } from './kit'

type Color = readonly [number, number, number]

const WHITE: Color = [0.8, 0.82, 0.85]
const STEEL: Color = [0.15, 0.16, 0.18]
const DARK: Color = [0.03, 0.03, 0.035]
const CONCRETE: Color = [0.3, 0.31, 0.33]
const GLASS: Color = [0.02, 0.022, 0.026]
const RED_GLOW = glow([1, 0.05, 0.03], 5)
const AMBER_GLOW = glow([1, 0.45, 0.05], 4)
const HEAD_GLOW = glow([0.9, 0.95, 1], 7)
const CARGO: Color[][] = [
  [[0.72, 0.56, 0.28], [0.6, 0.62, 0.65], [0.08, 0.08, 0.09], [0.75, 0.76, 0.78], [0.55, 0.05, 0.05], [0.6, 0.62, 0.65]],
  [[0.6, 0.62, 0.65], [0.72, 0.56, 0.28], [0.75, 0.76, 0.78], [0.08, 0.08, 0.09], [0.6, 0.62, 0.65], [0.1, 0.2, 0.5]],
  [[0.08, 0.08, 0.09], [0.75, 0.76, 0.78], [0.72, 0.56, 0.28], [0.55, 0.05, 0.05], [0.75, 0.76, 0.78], [0.6, 0.62, 0.65]],
]

/** Shared blinking materials for police lights; their colour is animated once per frame. */
class Blinkers {
  readonly red = new THREE.MeshBasicMaterial({ color: 0xff0000, fog: false })
  readonly blue = new THREE.MeshBasicMaterial({ color: 0x0044ff, fog: false })

  update(t: number): void {
    const phase = Math.floor(t * 7) % 4
    this.red.color.setRGB(phase < 2 ? 8 : 0.25, 0.02, 0.02)
    this.blue.color.setRGB(0.02, 0.1, phase >= 2 ? 9 : 0.3)
  }
}

function wheelPair(kit: Kit, x: number, radius: number, halfTrack: number, width: number): void {
  for (const s of [1, -1]) {
    const tire = new THREE.CylinderGeometry(radius, radius, width, 18)
    tire.rotateX(Math.PI / 2)
    tire.translate(x, radius, s * halfTrack)
    kit.add('matte', tire, DARK)
    const hub = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.02, 14)
    hub.rotateX(Math.PI / 2)
    hub.translate(x, radius, s * (halfTrack + width / 2 + 0.01))
    kit.add('paint', hub, [0.4, 0.42, 0.45])
  }
}

/** A small car on the transporter: body plus a tapered glasshouse, 3.8 m long. */
function cargoCar(kit: Kit, x: number, base: number, color: Color): void {
  kit.hexa(
    'paint',
    [
      [x, base + 0.3, -0.85], [x + 3.8, base + 0.3, -0.85], [x + 3.8, base + 0.3, 0.85], [x, base + 0.3, 0.85],
      [x + 0.1, base + 0.8, -0.85], [x + 3.7, base + 0.72, -0.85], [x + 3.7, base + 0.72, 0.85], [x + 0.1, base + 0.8, 0.85],
    ],
    color,
  )
  kit.hexa(
    'glass',
    [
      [x + 0.5, base + 0.78, -0.75], [x + 2.6, base + 0.75, -0.75], [x + 2.6, base + 0.75, 0.75], [x + 0.5, base + 0.78, 0.75],
      [x + 0.9, base + 1.22, -0.6], [x + 2.0, base + 1.22, -0.6], [x + 2.0, base + 1.22, 0.6], [x + 0.9, base + 1.22, 0.6],
    ],
    GLASS,
  )
  for (const wx of [x + 0.8, x + 3.0]) {
    for (const s of [1, -1]) {
      const tire = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12)
      tire.rotateX(Math.PI / 2)
      tire.translate(wx, base + 0.3, s * 0.78)
      kit.add('matte', tire, DARK)
    }
  }
  kit.box('glow', x - 0.02, x + 0.02, base + 0.55, base + 0.62, -0.75, 0.75, glow([1, 0.05, 0.03], 1.5))
}

/** White aero semi pulling a two-deck car transporter, like the one in the reference clip. */
function buildTruck(materials: Materials, variant: number): THREE.Group {
  const kit = new Kit()
  const L = TRUCK.trailerLength
  // Trailer frame.
  kit.box('matte', 0, L, 0.95, 1.15, -1.1, 1.1, STEEL)
  kit.box('paint', 0.1, L, 1.15, 1.25, -1.25, 1.25, [0.35, 0.36, 0.38])
  kit.box('paint', 0.2, L - 0.6, 2.55, 2.65, -1.25, 1.25, [0.35, 0.36, 0.38])
  for (const x of [0.2, 4.3, 8.3, L - 0.5]) {
    for (const s of [1, -1]) kit.box('paint', x, x + 0.14, 1.2, TRUCK.trailerHeight, s * 1.2, s * 1.3, [0.4, 0.41, 0.44])
  }
  for (const s of [1, -1]) {
    kit.box('paint', 0.2, L - 0.4, TRUCK.trailerHeight - 0.14, TRUCK.trailerHeight, s * 1.18, s * 1.3, [0.4, 0.41, 0.44])
    kit.box('paint', 0.2, L - 0.4, 2.0, 2.08, s * 1.2, s * 1.3, [0.4, 0.41, 0.44])
  }
  for (const x of [1.0, 2.1, 3.2]) wheelPair(kit, x, 0.5, 1.0, 0.42)
  // Tail and side marker lights.
  for (const s of [1, -1]) kit.box('glow', -0.03, 0.02, 0.95, 1.12, s * 0.8, s * 1.22, RED_GLOW)
  kit.box('glow', -0.03, 0.02, 3.75, 3.85, -1.1, 1.1, glow([1, 0.05, 0.03], 3))
  for (let x = 1; x < L; x += 2.4) for (const s of [1, -1]) kit.box('glow', x, x + 0.14, 1.0, 1.08, s * 1.11, s * 1.13, AMBER_GLOW)
  const cargo = CARGO[variant % CARGO.length]
  ;[1.0, 5.0, 9.0].forEach((x, i) => cargoCar(kit, x, 1.25, cargo[i]))
  ;[0.6, 4.6, 8.4].forEach((x, i) => cargoCar(kit, x, 2.65, cargo[i + 3]))

  // Cab.
  const c = L
  kit.box('matte', c, c + TRUCK.cabLength, 0.5, 1.1, -1.1, 1.1, STEEL)
  kit.hexa(
    'paint',
    [
      [c + 0.1, 1.0, -1.25], [c + 4.15, 1.0, -1.25], [c + 4.15, 1.0, 1.25], [c + 0.1, 1.0, 1.25],
      [c + 0.1, 2.2, -1.25], [c + 4.1, 2.2, -1.25], [c + 4.1, 2.2, 1.25], [c + 0.1, 2.2, 1.25],
    ],
    WHITE,
  )
  kit.hexa(
    'paint',
    [
      [c + 0.1, 2.2, -1.25], [c + 4.1, 2.2, -1.25], [c + 4.1, 2.2, 1.25], [c + 0.1, 2.2, 1.25],
      [c + 0.1, TRUCK.cabHeight, -1.05], [c + 2.5, TRUCK.cabHeight, -1.05], [c + 2.5, TRUCK.cabHeight, 1.05], [c + 0.1, TRUCK.cabHeight, 1.05],
    ],
    WHITE,
  )
  const slant = (y: number) => c + 4.1 - ((y - 2.2) * 1.6) / (TRUCK.cabHeight - 2.2)
  kit.hexa(
    'glass',
    [
      [slant(2.75) - 0.06, 2.75, -1.08], [slant(2.75) + 0.03, 2.75, -1.08], [slant(2.75) + 0.03, 2.75, 1.08], [slant(2.75) - 0.06, 2.75, 1.08],
      [slant(4.1) - 0.06, 4.1, -0.96], [slant(4.1) + 0.03, 4.1, -0.96], [slant(4.1) + 0.03, 4.1, 0.96], [slant(4.1) - 0.06, 4.1, 0.96],
    ],
    GLASS,
  )
  for (const s of [1, -1]) kit.box('glass', c + 1.6, c + 2.8, 2.75, 3.75, s * 1.13, s * 1.2, GLASS)
  kit.box('glow', c + 4.12, c + 4.18, 1.45, 1.55, -1.05, 1.05, HEAD_GLOW)
  for (const s of [1, -1]) kit.box('glow', c + 0.05, c + 0.12, 3.7, 4.3, s * 0.85, s * 1.0, RED_GLOW)
  kit.box('matte', c + 0.6, c + 3.6, 0.55, 1.0, -1.3, 1.3, [0.7, 0.72, 0.75])
  wheelPair(kit, c + 1.1, 0.55, 1.0, 0.42)
  wheelPair(kit, c + 3.3, 0.55, 1.0, 0.36)
  return kit.build(materials)
}

function buildOverpass(materials: Materials, deck: number): THREE.Group {
  const kit = new Kit()
  const h = OVERPASS_HALF
  kit.box('matte', -h, h, deck, deck + OVERPASS_DECK, -60, 11, CONCRETE)
  kit.box('matte', -h, h, deck + OVERPASS_DECK, deck + OVERPASS_DECK + 0.25, -60, 11, [0.22, 0.23, 0.25])
  for (const s of [1, -1]) {
    const x0 = s > 0 ? h - 0.25 : -h
    kit.box('matte', x0, x0 + 0.25, deck + OVERPASS_DECK, deck + OVERPASS_DECK + 1.0, -60, 11, [0.36, 0.37, 0.4])
    kit.box('glow', s * (h + 0.01) - 0.01, s * (h + 0.01) + 0.01, deck + 0.25, deck + 0.35, -60, 11, glow([0.9, 0.75, 0.45], 1.6))
  }
  for (const z of [-10, 10]) kit.box('matte', -0.9, 0.9, 0, deck, z - 0.9, z + 0.9, [0.26, 0.27, 0.29])
  // Lamps under the deck lighting the lane.
  for (const z of [-3, 3]) kit.box('glow', -0.5, 0.5, deck - 0.05, deck, z - 0.3, z + 0.3, glow([1, 0.82, 0.55], 5))
  return kit.build(materials)
}

function buildGantry(materials: Materials, y0: number, top: number, variant: number): THREE.Group {
  const kit = new Kit()
  if (variant === 2) {
    // Roadside billboard standing on the road.
    kit.box('matte', -0.25, 0.25, 0.6, top, -4.6, 4.6, [0.04, 0.05, 0.09])
    for (const s of [1, -1]) {
      kit.box('glow', -0.27, 0.27, 0.6, 0.75, -4.6, 4.6, glow([0.3, 0.7, 1], 3))
      kit.box('glow', -0.27, 0.27, top - 0.15, top, -4.6, 4.6, glow([0.3, 0.7, 1], 3))
      kit.box('matte', -0.2, 0.2, 0, 0.6, s * 3 - 0.2, s * 3 + 0.2, STEEL)
    }
    for (let y = 1.6; y < top - 1; y += 1.4) kit.box('glow', -0.27, 0.27, y, y + 0.5, -3.2, 3.2 - (y % 2.8) * 0.5, glow([1, 0.4, 0.1], 1.2))
    return kit.build(materials)
  }
  const truss = top - 0.8
  for (const s of [1, -1]) kit.box('matte', -0.25, 0.25, 0, top, s * 8.5 - 0.25, s * 8.5 + 0.25, STEEL)
  if (variant === 0) {
    // Overhead sign hanging from a truss.
    kit.box('matte', -0.4, 0.4, truss, top, -9, 9, STEEL)
    kit.box('paint', -0.22, 0.22, y0, truss, -4.6, 4.6, [0.02, 0.24, 0.1])
    kit.box('paint', -0.24, 0.24, y0, y0 + 0.12, -4.6, 4.6, [0.85, 0.88, 0.85])
    kit.box('paint', -0.24, 0.24, truss - 0.12, truss, -4.6, 4.6, [0.85, 0.88, 0.85])
    for (let y = y0 + 0.6; y < Math.min(truss - 0.4, y0 + 4.5); y += 1.1) kit.box('paint', -0.24, 0.24, y, y + 0.45, -3.5, 2.2, [0.85, 0.88, 0.85])
    kit.box('glow', -0.3, 0.3, y0 - 0.12, y0, -4.4, 4.4, glow([1, 0.95, 0.85], 3))
  } else {
    // Floodlight rig: a lit bar between the poles.
    kit.box('matte', -0.45, 0.45, y0, top, -9, 9, [0.12, 0.13, 0.15])
    for (let z = -7.5; z <= 7.5; z += 2.5) kit.box('glow', -0.38, 0.38, y0 + 0.2, top - 0.2, z - 0.7, z + 0.7, glow([0.9, 0.95, 1], 6))
  }
  return kit.build(materials)
}

function buildCrane(materials: Materials): { root: THREE.Group; arm: THREE.Group } {
  const kit = new Kit()
  const yellow: Color = [0.7, 0.5, 0.05]
  kit.box('matte', -0.9, 0.9, 0, CRANE_PIVOT_Y + 3, -17, -15.2, yellow)
  kit.box('matte', -0.5, 0.5, CRANE_PIVOT_Y + 1.5, CRANE_PIVOT_Y + 2.3, -17, 3, yellow)
  kit.box('matte', -0.7, 0.7, CRANE_PIVOT_Y + 0.4, CRANE_PIVOT_Y + 1.5, -0.7, 0.7, STEEL)
  kit.box('glow', -0.2, 0.2, CRANE_PIVOT_Y + 3, CRANE_PIVOT_Y + 3.4, -16.3, -15.9, RED_GLOW)
  const root = kit.build(materials)
  const armKit = new Kit()
  armKit.cylinder('matte', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0), 0.07, [0.3, 0.3, 0.32], 6)
  const chain = armKit.build(materials)
  chain.name = 'chain'
  const ballKit = new Kit()
  ballKit.sphere('paint', 0, 0, 0, BALL_RADIUS, [0.08, 0.08, 0.09], 20)
  const ring = new THREE.TorusGeometry(BALL_RADIUS * 1.01, 0.08, 8, 32)
  ring.rotateX(Math.PI / 2)
  ballKit.add('glow', ring, glow([1, 0.7, 0.05], 4))
  const ball = ballKit.build(materials)
  ball.name = 'ball'
  const arm = new THREE.Group()
  arm.add(chain, ball)
  root.add(arm)
  return { root, arm }
}

function buildDrone(materials: Materials, blink: Blinkers): THREE.Group {
  const kit = new Kit()
  kit.box('paint', -0.45, 0.45, -0.12, 0.14, -0.45, 0.45, [0.06, 0.06, 0.07])
  kit.box('paint', -0.25, 0.25, 0.14, 0.24, -0.25, 0.25, WHITE)
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    kit.cylinder('matte', new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(x * 0.75, 0.05, z * 0.75), 0.05, STEEL, 6)
    const rotor = new THREE.CylinderGeometry(0.38, 0.38, 0.02, 16)
    rotor.translate(x * 0.75, 0.14, z * 0.75)
    kit.add('matte', rotor, [0.12, 0.13, 0.15])
  }
  kit.box('glow', 0.44, 0.47, -0.05, 0.05, -0.3, 0.3, glow([1, 0.9, 0.8], 5))
  const group = kit.build(materials)
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), blink.red)
  red.position.set(0, 0.2, -0.5)
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), blink.blue)
  blue.position.set(0, 0.2, 0.5)
  group.add(red, blue)
  return group
}

/** Flying police interceptor; the nose is at x = 0 and it faces -x (toward the player). */
function buildInterceptor(materials: Materials, blink: Blinkers): THREE.Group {
  const kit = new Kit()
  const len = INTERCEPTOR_HALF * 2
  kit.hexa(
    'paint',
    [
      [0, -0.45, -0.85], [len, -0.45, -0.85], [len, -0.45, 0.85], [0, -0.45, 0.85],
      [0.05, 0.05, -0.85], [len, 0.2, -0.85], [len, 0.2, 0.85], [0.05, 0.05, 0.85],
    ],
    [0.03, 0.035, 0.045],
  )
  kit.hexa(
    'paint',
    [
      [0.8, 0.05, -0.86], [2.4, 0.12, -0.86], [2.4, 0.12, 0.86], [0.8, 0.05, 0.86],
      [0.8, -0.35, -0.86], [2.4, -0.35, -0.86], [2.4, -0.35, 0.86], [0.8, -0.35, 0.86],
    ],
    WHITE,
  )
  kit.hexa(
    'glass',
    [
      [0.7, 0.07, -0.72], [2.6, 0.17, -0.72], [2.6, 0.17, 0.72], [0.7, 0.07, 0.72],
      [1.3, 0.5, -0.58], [2.3, 0.5, -0.58], [2.3, 0.5, 0.58], [1.3, 0.5, 0.58],
    ],
    GLASS,
  )
  for (const s of [1, -1]) kit.box('glow', -0.03, 0.04, -0.2, -0.08, s * 0.45, s * 0.8, HEAD_GLOW)
  for (const x of [0.6, len - 0.6]) for (const s of [1, -1]) kit.box('glow', x - 0.2, x + 0.2, -0.5, -0.46, s * 0.55 - 0.2, s * 0.55 + 0.2, glow([0.4, 0.9, 1], 5))
  const group = kit.build(materials)
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.5), blink.red)
  red.position.set(1.8, 0.56, -0.27)
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.5), blink.blue)
  blue.position.set(1.8, 0.56, 0.27)
  // Headlight beams so you can see it coming.
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 14, 20, 1, true), beamMaterial())
  beam.rotation.z = -Math.PI / 2
  beam.position.set(-7, -0.15, 0)
  group.add(red, blue, beam)
  return group
}

function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying float vT; varying float vRim; void main(){ vT = position.y / 14.0 + 0.5; vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); vRim = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vT; varying float vRim; void main(){ float a = pow(vT, 2.0) * pow(vRim, 2.0) * 0.35; gl_FragColor = vec4(vec3(0.8, 0.9, 1.0) * a, a); }`,
  })
}

function buildWall(materials: Materials): THREE.Group {
  const R = WALL.radius
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  const curve: THREE.Vector2[] = []
  for (let i = 0; i <= 24; i++) {
    const u = (i / 24) * R
    curve.push(new THREE.Vector2(u, R - Math.sqrt(R * R - u * u)))
  }
  for (const p of curve.slice(1)) shape.lineTo(p.x, p.y)
  shape.lineTo(R, WALL.top)
  shape.lineTo(R + WALL.back, WALL.top)
  shape.lineTo(R + WALL.back, 0)
  shape.lineTo(0, 0)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 9, bevelEnabled: false, curveSegments: 1 })
  geometry.translate(0, 0, -4.5)
  const kit = new Kit()
  kit.add('matte', geometry, [0.5, 0.51, 0.53])
  // Glowing guide lines up the face (the clip's white edge lines) and red lights on the lip.
  for (const z of [-4.3, 0, 4.3]) {
    // Lift each point off the face toward the curve's centre (0, R).
    const points = [...curve, new THREE.Vector2(R, WALL.top)].map((p) => {
      const off = new THREE.Vector2(-p.x, R - p.y).normalize().multiplyScalar(0.07)
      return new THREE.Vector3(p.x + off.x, p.y + off.y, z)
    })
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, z === 0 ? 0.05 : 0.08, 6)
    kit.add('glow', tube, glow([0.9, 0.95, 1], z === 0 ? 2 : 4))
  }
  for (let z = -4; z <= 4; z += 1) kit.box('glow', R - 0.1, R + 0.4, WALL.top, WALL.top + 0.12, z - 0.25, z + 0.25, RED_GLOW)
  return kit.build(materials)
}

const laserVertex = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const laserFragment = `
  uniform vec3 uColor; uniform float uPower; varying vec2 vUv;
  void main(){
    float d = abs(vUv.y - 0.5) * 2.0;
    float core = exp(-d * d * 18.0);
    float halo = exp(-d * d * 3.0) * 0.4;
    vec3 c = mix(uColor, vec3(1.0), core * 0.7) * (core + halo) * uPower;
    gl_FragColor = vec4(c, 1.0);
  }`

function buildLaser(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 0.08, 0.05) }, uPower: { value: 0 } },
    vertexShader: laserVertex,
    fragmentShader: laserFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  // A camera-facing-enough strip: a vertical ribbon plus a horizontal one.
  const a = new THREE.PlaneGeometry(160, 1)
  const b = new THREE.PlaneGeometry(160, 1)
  b.rotateX(Math.PI / 2)
  const merged = new THREE.BufferGeometry()
  const positions = [...a.toNonIndexed().attributes.position.array, ...b.toNonIndexed().attributes.position.array]
  const uvs = [...a.toNonIndexed().attributes.uv.array, ...b.toNonIndexed().attributes.uv.array]
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  const mesh = new THREE.Mesh(merged, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 4
  return mesh
}

function warningTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.moveTo(64, 8)
  ctx.lineTo(122, 116)
  ctx.lineTo(6, 116)
  ctx.closePath()
  ctx.fillStyle = '#ff2a1a'
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 72px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('!', 64, 104)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,1)')
  g.addColorStop(0.5, 'rgba(0,0,0,0.6)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(canvas)
}

/** Soft dark blobs on the road under anything in the air: the main height cue from this angle. */
export class Shadows {
  private readonly geometry: THREE.PlaneGeometry
  private readonly material: THREE.MeshBasicMaterial
  private readonly pool: THREE.Mesh[] = []
  private used = 0
  private readonly group = new THREE.Group()

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.PlaneGeometry(1, 1)
    this.geometry.rotateX(-Math.PI / 2)
    this.material = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 1 })
    scene.add(this.group)
  }

  begin(): void {
    this.used = 0
  }

  add(x: number, height: number, length: number, width: number, strength = 0.8): void {
    let mesh = this.pool[this.used]
    if (!mesh) {
      mesh = new THREE.Mesh(this.geometry, this.material.clone())
      mesh.renderOrder = 1
      this.pool.push(mesh)
      this.group.add(mesh)
    }
    this.used++
    const spread = 1 + height * 0.06
    mesh.position.set(x, 0.03, 0)
    mesh.scale.set(length * spread, 1, width * spread)
    ;(mesh.material as THREE.MeshBasicMaterial).opacity = strength * Math.max(0.12, 1 - height / 20)
    mesh.visible = true
  }

  end(): void {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false
  }
}

type View = {
  kind: ObstacleKind
  root: THREE.Object3D
  /** Pooled views go back to the pool; built-per-obstacle views are disposed. */
  pooled: boolean
  key: string
}

const CELL_CAPACITY = 200

export class Props {
  private readonly scene: THREE.Scene
  private readonly materials: Materials
  private readonly blink = new Blinkers()
  private readonly views = new Map<number, View>()
  private readonly pools = new Map<string, THREE.Object3D[]>()
  private readonly cells: THREE.InstancedMesh
  private readonly warning: THREE.Sprite[] = []
  private readonly shadows: Shadows
  private readonly dummy = new THREE.Object3D()

  constructor(scene: THREE.Scene, materials: Materials, shadows: Shadows) {
    this.scene = scene
    this.materials = materials
    this.shadows = shadows
    const cellGeometry = new THREE.CylinderGeometry(0.28, 0.28, 0.78, 12)
    const capGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.12, 8)
    capGeometry.translate(0, 0.45, 0)
    const cellKit = new Kit()
    cellKit.add('glow', cellGeometry, glow([0.25, 1, 0.75], 2.6))
    cellKit.add('glow', capGeometry, glow([0.9, 1, 0.95], 3))
    const merged = (cellKit.build(materials).children[0] as THREE.Mesh).geometry
    this.cells = new THREE.InstancedMesh(merged, materials.glow, CELL_CAPACITY)
    this.cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.cells.frustumCulled = false
    this.cells.count = 0
    scene.add(this.cells)

    const warnMaterial = new THREE.SpriteMaterial({ map: warningTexture(), depthTest: false, fog: false })
    for (let i = 0; i < 6; i++) {
      const sprite = new THREE.Sprite(warnMaterial.clone())
      sprite.visible = false
      sprite.renderOrder = 10
      this.warning.push(sprite)
      scene.add(sprite)
    }
  }

  reset(): void {
    for (const view of this.views.values()) this.release(view)
    this.views.clear()
    this.cells.count = 0
  }

  private acquire(o: Obstacle): View {
    const pooledKey =
      o.kind === 'truck' ? `truck${o.variant % 3}` : o.kind === 'overpass' || o.kind === 'gantry' ? '' : o.kind
    if (pooledKey) {
      const pool = this.pools.get(pooledKey) ?? []
      const root = pool.pop() ?? this.build(o)
      root.visible = true
      this.scene.add(root)
      return { kind: o.kind, root, pooled: true, key: pooledKey }
    }
    const root = this.build(o)
    this.scene.add(root)
    return { kind: o.kind, root, pooled: false, key: '' }
  }

  private release(view: View): void {
    this.scene.remove(view.root)
    if (view.pooled) {
      const pool = this.pools.get(view.key) ?? []
      pool.push(view.root)
      this.pools.set(view.key, pool)
    } else {
      view.root.traverse((n) => {
        if (n instanceof THREE.Mesh) n.geometry.dispose()
      })
    }
  }

  private build(o: Obstacle): THREE.Object3D {
    switch (o.kind) {
      case 'truck':
        return buildTruck(this.materials, o.variant)
      case 'overpass':
        return buildOverpass(this.materials, o.y)
      case 'gantry':
        return buildGantry(this.materials, o.y, o.a, o.variant)
      case 'crane':
        return buildCrane(this.materials).root
      case 'drone':
        return buildDrone(this.materials, this.blink)
      case 'interceptor':
        return buildInterceptor(this.materials, this.blink)
      case 'wall':
        return buildWall(this.materials)
      case 'laser':
        return buildLaser()
    }
  }

  /** Screen-right world x at height y, for warning markers (found by bisection on the projection). */
  private edgeX(camera: THREE.Camera, carX: number, y: number, ndc: number): number {
    const v = new THREE.Vector3()
    let lo = carX
    let hi = carX + 200
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2
      v.set(mid, y, 0).project(camera)
      if (v.x < ndc) lo = mid
      else hi = mid
    }
    return lo
  }

  update(s: SimState, camera: THREE.Camera, viewX0: number, viewX1: number): void {
    this.blink.update(s.t)
    const live = new Set<number>()
    let warnings = 0
    for (const o of s.obstacles) {
      const inView = o.x1 > viewX0 && o.x0 < viewX1
      if (o.kind === 'laser' ? o.state !== 'warn' && o.state !== 'active' : o.kind === 'interceptor' ? o.state === 'idle' || o.state === 'done' || (o.state === 'active' && !inView) : !inView) continue
      if (o.kind === 'interceptor' && o.state === 'warn') {
        const sprite = this.warning[warnings++]
        if (sprite) {
          const locked = o.stateT > INTERCEPTOR_WARN - INTERCEPTOR_LOCK
          sprite.visible = true
          sprite.position.set(this.edgeX(camera, s.car.x, o.y, 0.82), o.y, 0)
          const pulse = locked ? 1.25 : 0.95 + 0.15 * Math.sin(o.stateT * 18)
          sprite.scale.setScalar(1.6 * pulse)
          ;(sprite.material as THREE.SpriteMaterial).opacity = locked ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(o.stateT * 9))
        }
        continue
      }
      live.add(o.id)
      let view = this.views.get(o.id)
      if (!view) {
        view = this.acquire(o)
        this.views.set(o.id, view)
      }
      this.pose(view, o, s)
      if (o.kind === 'laser' && o.state === 'warn') {
        const sprite = this.warning[warnings++]
        if (sprite) {
          sprite.visible = true
          sprite.position.set(this.edgeX(camera, s.car.x, o.y, 0.86), o.y, 0)
          sprite.scale.setScalar(1.1)
          ;(sprite.material as THREE.SpriteMaterial).opacity = Math.abs(Math.sin(o.stateT * 10))
        }
      }
    }
    for (let i = warnings; i < this.warning.length; i++) this.warning[i].visible = false
    for (const [id, view] of this.views) {
      if (!live.has(id)) {
        this.release(view)
        this.views.delete(id)
      }
    }

    let n = 0
    for (const cell of s.cells) {
      if (cell.taken || cell.x < viewX0 || cell.x > viewX1 || n >= CELL_CAPACITY) continue
      this.dummy.position.set(cell.x, cell.y + Math.sin(s.t * 3 + cell.x * 0.3) * 0.12, 0)
      this.dummy.rotation.set(0.35, s.t * 2.5 + cell.x, 0.2)
      this.dummy.updateMatrix()
      this.cells.setMatrixAt(n++, this.dummy.matrix)
    }
    this.cells.count = n
    this.cells.instanceMatrix.needsUpdate = true
  }

  private pose(view: View, o: Obstacle, s: SimState): void {
    const root = view.root
    switch (o.kind) {
      case 'truck':
        root.position.set(o.x, 0, 0)
        break
      case 'overpass':
      case 'gantry':
      case 'wall':
        root.position.set(o.x, 0, 0)
        break
      case 'crane': {
        root.position.set(o.x, 0, 0)
        const arm = root.children[root.children.length - 1]
        const ball = craneBall(o, s.t)
        arm.position.set(0, CRANE_PIVOT_Y, 0)
        arm.rotation.z = ball.angle
        const chain = arm.getObjectByName('chain')!
        chain.scale.set(1, o.a - BALL_RADIUS, 1)
        arm.getObjectByName('ball')!.position.set(0, -o.a, 0)
        if (ball.y < CEILING_Y + 3) this.shadows.add(ball.x, ball.y, 2.6, 2.6, 0.7)
        break
      }
      case 'drone':
        root.position.set(o.x, o.y, 0)
        root.rotation.set(Math.sin(s.t * 3 + o.c) * 0.12, 0, Math.sin(s.t * 2 + o.c) * 0.15)
        this.shadows.add(o.x, o.y, DRONE_RADIUS * 2.2, DRONE_RADIUS * 2.2, 0.6)
        break
      case 'interceptor':
        root.position.set(o.x, o.y, 0)
        root.rotation.z = Math.sin(s.t * 4) * 0.04
        this.shadows.add(o.x + INTERCEPTOR_HALF, o.y, 3.6, 1.9, 0.7)
        break
      case 'laser': {
        const mesh = root as THREE.Mesh
        const material = mesh.material as THREE.ShaderMaterial
        mesh.position.set(s.car.x + 20, o.y, 0)
        const warn = o.state === 'warn'
        const blinkOn = Math.sin(o.stateT * 26) > -0.2
        material.uniforms.uPower.value = warn ? (blinkOn ? 0.9 : 0.25) : 3.2
        mesh.scale.set(1, warn ? 0.18 : LASER_HALF_THICKNESS * 2.6, warn ? 0.18 : LASER_HALF_THICKNESS * 2.6)
        material.uniforms.uColor.value.setRGB(1, warn ? 0.25 : 0.06, 0.05)
        break
      }
    }
  }
}

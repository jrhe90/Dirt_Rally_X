import * as THREE from 'three'
import type { Autopilot } from '../sim/fsd/autopilot'
import { PLAN_STEPS, sampleTrajectory, type Trajectory } from '../sim/fsd/planner'
import type { Road, RoadPoint } from '../sim/road'
import type { SimState } from '../sim/types'

/**
 * The autopilot's view of the world, drawn into the scene: its planned path as a glowing ribbon
 * on the road (blue, red when it wants the driver to take over), faint runner-up paths in other
 * lanes, and a ground outline around every tracked object, coloured by role (the vehicle it is
 * following, police, hazards, everything else).
 */

const PATH_POINTS = 56

const RIBBON_VERT = /* glsl */ `
  attribute float aAlong;
  attribute float aSide;
  varying float vAlong;
  varying float vSide;
  void main() {
    vAlong = aAlong;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uLength;
  varying float vAlong;
  varying float vSide;
  void main() {
    float edge = 1.0 - abs(vSide);
    float core = smoothstep(0.0, 0.35, edge);
    float rim = smoothstep(0.75, 0.95, abs(vSide)) * 0.9;
    float fade = smoothstep(1.5, 5.0, vAlong) * (1.0 - smoothstep(uLength * 0.6, uLength, vAlong));
    // Chevrons flowing forward.
    float chev = fract((vAlong - abs(vSide) * 1.2) * 0.22 - uTime * 0.9);
    float chevron = smoothstep(0.0, 0.08, chev) * (1.0 - smoothstep(0.18, 0.3, chev)) * 0.55;
    float a = (core * 0.4 + rim * 1.2 + chevron * core * 1.4) * fade * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`

const BOX_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec2 uSize;
  uniform float uOpacity;
  varying vec2 vUv;
  float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float d = sdBox(p, uSize * 0.5 - 0.12, 0.35);
    float line = 1.0 - smoothstep(0.03, 0.1, abs(d));
    float fill = d < 0.0 ? 0.12 : 0.0;
    float a = (line + fill) * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`
const BOX_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

const BLUE = new THREE.Color(0.25, 0.75, 3.2)
const RED = new THREE.Color(3.4, 0.25, 0.2)
const WHITE = new THREE.Color(0.9, 0.95, 1.1)
const LEAD = new THREE.Color(0.3, 0.9, 3.0)
const POLICE_A = new THREE.Color(3.2, 0.3, 0.3)
const POLICE_B = new THREE.Color(0.3, 0.6, 3.6)
const HAZARD = new THREE.Color(3.2, 1.4, 0.15)

class Ribbon {
  private readonly width: number
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  private readonly positions: Float32Array
  private readonly geometry: THREE.BufferGeometry
  private readonly pt: RoadPoint = { x: 0, y: 0, z: 0, psi: 0, kappa: 0 }

  constructor(width: number, opacity: number) {
    this.positions = new Float32Array(PATH_POINTS * 2 * 3)
    const along = new Float32Array(PATH_POINTS * 2)
    const side = new Float32Array(PATH_POINTS * 2)
    const index: number[] = []
    for (let i = 0; i < PATH_POINTS; i++) {
      side[i * 2] = -1
      side[i * 2 + 1] = 1
      if (i < PATH_POINTS - 1) {
        const a = i * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1))
    this.geometry.setIndex(index)
    this.material = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      uniforms: { uColor: { value: BLUE.clone() }, uTime: { value: 0 }, uOpacity: { value: opacity }, uLength: { value: 100 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
    this.width = width
  }

  set(road: Road, tr: Trajectory, tau0: number, egoS: number, egoD: number): void {
    const along = this.geometry.attributes.aAlong.array as Float32Array
    const horizon = (PLAN_STEPS - 1) * 0.2
    let prevX = 0
    let prevZ = 0
    let dist = 0
    for (let i = 0; i < PATH_POINTS; i++) {
      const tau = tau0 + ((horizon - tau0) * i) / (PATH_POINTS - 1)
      let s = sampleTrajectory(tr, tau, 's')
      let d = sampleTrajectory(tr, tau, 'd')
      // Start exactly at the car so the ribbon doesn't float.
      if (i === 0) {
        s = egoS
        d = egoD
      }
      const p = road.point(s, d, this.pt)
      const lx = -Math.sin(p.psi)
      const lz = -Math.cos(p.psi)
      const hw = this.width / 2
      const k = i * 6
      this.positions[k] = p.x - lx * hw
      this.positions[k + 1] = p.y + 0.06
      this.positions[k + 2] = p.z - lz * hw
      this.positions[k + 3] = p.x + lx * hw
      this.positions[k + 4] = p.y + 0.06
      this.positions[k + 5] = p.z + lz * hw
      if (i > 0) dist += Math.hypot(p.x - prevX, p.z - prevZ)
      prevX = p.x
      prevZ = p.z
      along[i * 2] = along[i * 2 + 1] = dist
    }
    this.material.uniforms.uLength.value = Math.max(20, dist)
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aAlong.needsUpdate = true
    this.geometry.computeBoundingSphere()
  }
}

export class Overlay {
  readonly group = new THREE.Group()
  private readonly path = new Ribbon(1.7, 1)
  private readonly alts = [new Ribbon(1.2, 0.28), new Ribbon(1.2, 0.28)]
  private readonly boxes: THREE.Mesh[] = []
  private readonly boxGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  private readonly pt: RoadPoint = { x: 0, y: 0, z: 0, psi: 0, kappa: 0 }
  enabled = true
  showAlternatives = false

  constructor(scene: THREE.Scene) {
    this.group.add(this.path.mesh, ...this.alts.map((a) => a.mesh))
    for (const a of this.alts) a.material.uniforms.uColor.value.copy(WHITE)
    scene.add(this.group)
  }

  private box(i: number): THREE.Mesh {
    while (this.boxes.length <= i) {
      const m = new THREE.Mesh(
        this.boxGeo,
        new THREE.ShaderMaterial({
          vertexShader: BOX_VERT,
          fragmentShader: BOX_FRAG,
          uniforms: { uColor: { value: new THREE.Color() }, uSize: { value: new THREE.Vector2(4, 2) }, uOpacity: { value: 1 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -4,
        }),
      )
      m.renderOrder = 6
      m.frustumCulled = false
      this.group.add(m)
      this.boxes.push(m)
    }
    return this.boxes[i]
  }

  update(sim: SimState, ap: Autopilot, time: number): void {
    const show = this.enabled && ap.engaged && !!ap.plan
    this.path.mesh.visible = show
    for (const a of this.alts) a.mesh.visible = false
    if (show && ap.plan) {
      const tau0 = sim.t - ap.plan.t0
      this.path.set(sim.road, ap.plan, tau0, sim.ego.s, sim.ego.d)
      const takeover = ap.status.takeover
      this.path.material.uniforms.uColor.value.copy(takeover ? RED : BLUE)
      this.path.material.uniforms.uTime.value = time
      if (this.showAlternatives) {
        ap.alternatives.slice(0, 2).forEach((tr, i) => {
          this.alts[i].mesh.visible = true
          this.alts[i].set(sim.road, tr, tau0, sim.ego.s, sim.ego.d)
          this.alts[i].material.uniforms.uTime.value = time
        })
      }
    }

    let n = 0
    if (this.enabled) {
      const e = sim.ego
      const pulse = Math.floor(time * 6) % 2 === 0
      for (const t of ap.perception.tracks.values()) {
        if (t.kind === 'oncoming' || Math.abs(t.s - e.s) > 130 || !t.visible) continue
        const m = this.box(n++)
        const u = (m.material as THREE.ShaderMaterial).uniforms
        const p = sim.road.point(t.s, t.d, this.pt)
        m.position.set(p.x, p.y + 0.05, p.z)
        m.rotation.set(0, p.psi + t.psi, 0)
        const lw = t.length + 0.5
        const ww = t.width + 0.5
        m.scale.set(lw, 1, ww)
        u.uSize.value.set(lw, ww)
        const color =
          t.kind === 'police' ? (pulse ? POLICE_A : POLICE_B) : t.kind === 'block' || t.kind === 'wreck' ? HAZARD : t.id === ap.status.leadId && ap.engaged ? LEAD : WHITE
        u.uColor.value.copy(color)
        const dist = Math.abs(t.s - e.s)
        u.uOpacity.value = (color === WHITE ? 0.35 : 0.9) * (1 - THREE.MathUtils.smoothstep(dist, 70, 130))
        m.visible = true
      }
      for (const k of ap.perception.spikes) {
        const m = this.box(n++)
        const u = (m.material as THREE.ShaderMaterial).uniforms
        const p = sim.road.point(k.s, (k.d0 + k.d1) / 2, this.pt)
        m.position.set(p.x, p.y + 0.05, p.z)
        m.rotation.set(0, p.psi, 0)
        const ww = k.d1 - k.d0 + 0.4
        m.scale.set(2, 1, ww)
        u.uSize.value.set(2, ww)
        u.uColor.value.copy(HAZARD)
        u.uOpacity.value = 1
        m.visible = true
      }
    }
    for (let i = n; i < this.boxes.length; i++) this.boxes[i].visible = false
  }
}

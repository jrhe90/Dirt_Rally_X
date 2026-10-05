import * as THREE from 'three'
import { mulberry32, smoothstep } from '../heights'
import type { Placement, Scenery } from '../scenery'
import type { Terrain } from '../terrain'
import { WALL, type Track } from '../track'
import type { GameAssets } from './assets'

const TREE_VARIANTS = 3

export type SceneryVisuals = {
  group: THREE.Group
  update: (elapsed: number) => void
}

export function createSceneryVisuals(
  scenery: Scenery,
  terrain: Terrain,
  track: Track,
  assets: GameAssets,
  grassCount: number,
): SceneryVisuals {
  const group = new THREE.Group()
  group.name = 'scenery'

  const trees = scenery.placements.filter((p) => p.kind === 'tree')
  const rocks = scenery.placements.filter((p) => p.kind !== 'tree')
  group.add(createTrees(trees, assets))
  group.add(createRocks(rocks, assets))
  const grass = createGrass(terrain, track, grassCount)
  group.add(grass.mesh)

  return { group, update: grass.update }
}

/** Keeps authored outward normals on double-sided cards instead of flipping them per face. */
function keepCardNormals(shader: { fragmentShader: string }) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_begin>',
    THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
  )
}

/** Raises alpha with distance so alpha-tested foliage keeps its coverage in lower mip levels. */
const MIP_ALPHA_GLSL = /* glsl */ `
  #include <map_fragment>
  {
    vec2 texel = vMapUv * MIP_TEX_SIZE;
    vec2 ddx = dFdx(texel);
    vec2 ddy = dFdy(texel);
    float mip = 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy)));
    diffuseColor.a *= 1.0 + max(0.0, mip) * 0.28;
  }
`

function createTrees(placements: Placement[], assets: GameAssets): THREE.Group {
  const group = new THREE.Group()
  const needles = createNeedleTexture()
  const bark = assets.pbr.bark_brown_02

  const foliageMat = new THREE.MeshStandardMaterial({
    map: needles,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.55,
  })
  foliageMat.onBeforeCompile = (shader) => {
    keepCardNormals(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', MIP_ALPHA_GLSL)
      .replace('#include <common>', '#include <common>\n#define MIP_TEX_SIZE vec2(512.0, 256.0)')
  }
  foliageMat.customProgramCacheKey = () => 'foliage'

  const trunkMat = new THREE.MeshStandardMaterial({
    map: bark.diff,
    normalMap: bark.nor,
    roughnessMap: bark.arm,
    roughness: 1,
    color: 0x8a7a6c,
  })
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x1a2614, roughness: 1, envMapIntensity: 0.4 })

  const byVariant: Placement[][] = Array.from({ length: TREE_VARIANTS }, () => [])
  for (const p of placements) byVariant[p.variant % TREE_VARIANTS].push(p)

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const color = new THREE.Color()
  const dark = new THREE.Color(0x5c6e50)
  const warm = new THREE.Color(0x9ea47c)

  byVariant.forEach((list, v) => {
    if (list.length === 0) return
    const height = 13 + v * 1.5
    const { trunk, foliage } = buildTree(mulberry32(100 + v * 17), height)
    // Opaque dark core hides the gaps between branch cards so the crown reads as dense.
    const core = new THREE.ConeGeometry(height * 0.1, height * 0.7, 8, 1, true).translate(0, height * 0.55, 0)
    const trunkMesh = new THREE.InstancedMesh(trunk, trunkMat, list.length)
    const foliageMesh = new THREE.InstancedMesh(foliage, foliageMat, list.length)
    const coreMesh = new THREE.InstancedMesh(core, coreMat, list.length)
    list.forEach((p, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.rotation)
      m.compose(p.position.clone().setY(p.position.y - 0.15), q, p.scale)
      trunkMesh.setMatrixAt(i, m)
      foliageMesh.setMatrixAt(i, m)
      coreMesh.setMatrixAt(i, m)
      color.copy(dark).lerp(warm, p.tint * 0.6).multiplyScalar(1.05)
      foliageMesh.setColorAt(i, color)
    })
    for (const mesh of [trunkMesh, coreMesh, foliageMesh]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      group.add(mesh)
    }
  })
  return group
}

/** A spruce: tapered bark trunk plus whorls of drooping, slightly twisted branch cards. */
function buildTree(rng: () => number, height: number) {
  const trunk = new THREE.CylinderGeometry(0.06, 0.3, height * 0.95, 9, 8, true).translate(0, (height * 0.95) / 2, 0)
  const tuv = trunk.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 2, tuv.getY(i) * height * 0.5)

  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const radius = height * 0.23
  const whorls = 18

  const pushVertex = (p: THREE.Vector3, u: number, v: number, centerY: number) => {
    pos.push(p.x, p.y, p.z)
    const n = new THREE.Vector3(p.x, (p.y - centerY) * 0.6 + 0.8, p.z).normalize()
    nor.push(n.x, n.y, n.z)
    uv.push(u, v)
  }

  const card = (base: THREE.Vector3, dir: THREE.Vector3, length: number, width: number, droop: number, twist: number) => {
    const side = new THREE.Vector3().crossVectors(dir, up).normalize()
    side.multiplyScalar(Math.cos(twist)).addScaledVector(up, Math.sin(twist))
    const point = (t: number) => {
      const d = droop * t * t
      return base
        .clone()
        .addScaledVector(dir, length * t * Math.cos(d))
        .addScaledVector(up, -length * t * Math.sin(d))
    }
    const steps = [0, 0.5, 1]
    const rows = steps.map((t) => {
      const c = point(t)
      const w = width * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.6 + 0.15) * Math.PI * 0.5))
      return [c.clone().addScaledVector(side, -w / 2), c.clone().addScaledVector(side, w / 2), t] as const
    })
    for (let k = 0; k < rows.length - 1; k++) {
      const [a0, a1, ta] = rows[k]
      const [b0, b1, tb] = rows[k + 1]
      const cy = base.y - 0.6
      pushVertex(a0, ta, 0, cy)
      pushVertex(b0, tb, 0, cy)
      pushVertex(a1, ta, 1, cy)
      pushVertex(a1, ta, 1, cy)
      pushVertex(b0, tb, 0, cy)
      pushVertex(b1, tb, 1, cy)
    }
  }

  for (let k = 0; k < whorls; k++) {
    const f = k / (whorls - 1)
    const y = height * (0.16 + 0.76 * f) + (rng() - 0.5) * 0.3
    const r = radius * Math.pow(1 - f * 0.92, 0.9) + 0.35
    const count = f > 0.8 ? 5 : f > 0.5 ? 7 : 8
    const offset = rng() * Math.PI * 2
    for (let j = 0; j < count; j++) {
      const a = offset + (j / count) * Math.PI * 2 + (rng() - 0.5) * 0.5
      const dir = new THREE.Vector3(Math.cos(a), 0.08 + rng() * 0.12, Math.sin(a)).normalize()
      const len = r * (0.8 + rng() * 0.35)
      card(new THREE.Vector3(dir.x * 0.08, y, dir.z * 0.08), dir, len, Math.max(1.0, len * 0.95), 0.45 + rng() * 0.35, (rng() - 0.5) * 1.2)
    }
  }
  for (let j = 0; j < 3; j++) {
    const a = (j / 3) * Math.PI
    const dir = new THREE.Vector3(Math.cos(a) * 0.05, 1, Math.sin(a) * 0.05).normalize()
    card(new THREE.Vector3(0, height * 0.86, 0), dir, height * 0.16, 1.1, 0, 0)
  }

  const foliage = new THREE.BufferGeometry()
  foliage.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  foliage.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  foliage.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return { trunk, foliage }
}

function createNeedleTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const rng = mulberry32(42)
  ctx.lineCap = 'round'

  const envelope = (t: number) => Math.pow(Math.sin(Math.min(1, t * 1.25 + 0.05) * Math.PI * 0.5), 0.7) * (1 - t * 0.35)

  ctx.strokeStyle = '#3a2a1c'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w * 0.97, h / 2)
  ctx.stroke()

  for (let i = 0; i < 90; i++) {
    const t = i / 90
    const x = t * w * 0.95
    const reach = envelope(t) * (h / 2 - 4)
    for (const s of [-1, 1]) {
      const angle = (0.55 + rng() * 0.35) * s
      const len = reach * (0.75 + rng() * 0.3)
      const ex = x + Math.cos(angle) * len * 0.6
      const ey = h / 2 + Math.sin(angle) * len
      ctx.strokeStyle = '#3d2e1e'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(x, h / 2)
      ctx.lineTo(ex, ey)
      ctx.stroke()

      for (let k = 0; k < 22; k++) {
        const u = k / 22
        const px = x + (ex - x) * u
        const py = h / 2 + (ey - h / 2) * u
        for (const side of [-1, 1]) {
          const a = angle * 0.4 + side * (0.9 + rng() * 0.5)
          const nl = 9 + rng() * 11
          const shade = rng()
          const g = Math.floor(40 + shade * 50)
          ctx.strokeStyle = `rgb(${Math.floor(g * 0.52)},${g},${Math.floor(g * 0.38)})`
          ctx.lineWidth = 2.2
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(px + Math.cos(a) * nl * 0.7 + 3, py + Math.sin(a) * nl)
          ctx.stroke()
        }
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function createRocks(placements: Placement[], assets: GameAssets): THREE.Group {
  const group = new THREE.Group()
  const material = assets.rockMaterial.clone()
  material.color.set(0xd0c8bc)
  const variants = assets.rocks.length
  const byVariant: Placement[][] = Array.from({ length: variants }, () => [])
  for (const p of placements) byVariant[p.variant % variants].push(p)

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const color = new THREE.Color()
  byVariant.forEach((list, v) => {
    if (list.length === 0) return
    const mesh = new THREE.InstancedMesh(assets.rocks[v], material, list.length)
    list.forEach((p, i) => {
      e.set((p.tint - 0.5) * 0.3, p.rotation, (p.tint - 0.5) * 0.2)
      q.setFromEuler(e)
      m.compose(p.position.clone().setY(p.position.y - 0.08 * p.scale.y), q, p.scale)
      mesh.setMatrixAt(i, m)
      color.setScalar(0.85 + p.tint * 0.3)
      mesh.setColorAt(i, color)
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    group.add(mesh)
  })
  return group
}

function createGrass(terrain: Terrain, track: Track, count: number) {
  const tuft = buildTuftGeometry()
  const uniforms = { uTime: { value: 0 } }
  const material = new THREE.MeshStandardMaterial({
    map: createGrassTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    keepCardNormals(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 phase = instanceMatrix[3].xz;
        #else
          vec2 phase = vec2(0.0);
        #endif
        float sway = sin(uTime * 1.7 + phase.x * 0.35 + phase.y * 0.21) + 0.4 * sin(uTime * 3.1 + phase.y * 0.7);
        transformed.xz += vec2(0.07, 0.04) * sway * uv.y * uv.y;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', `${MIP_ALPHA_GLSL}\n diffuseColor.rgb *= mix(0.45, 1.0, vMapUv.y);`)
      .replace('#include <common>', '#include <common>\n#define MIP_TEX_SIZE vec2(256.0, 128.0)')
  }
  material.customProgramCacheKey = () => 'grass'

  const rng = mulberry32(99)
  const edge = track.halfWidth + track.shoulder
  const [wallStart, wallEnd] = track.wallRange
  const matrices: THREE.Matrix4[] = []
  const colors: THREE.Color[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const green = new THREE.Color(0.95, 1.0, 0.8)
  const dry = new THREE.Color(1.25, 1.1, 0.7)

  for (let i = 0; i < count * 2 && matrices.length < count; i++) {
    const { position, tangent, index } = track.pointAt(rng() * track.length)
    const side = rng() > 0.5 ? 1 : -1
    const lateral = edge - 0.6 + rng() ** 1.8 * 32
    if (index > wallStart - 3 && index < wallEnd + 3 && lateral < WALL.offset + 0.6) continue
    const x = position.x + tangent.z * lateral * side
    const z = position.z - tangent.x * lateral * side
    if (Math.abs(track.project(x, z, index).lateral) < edge - 0.8) continue
    terrain.normalAt(x, z, normal)
    if (normal.y < 0.88) continue

    p.set(x, terrain.heightAt(x, z) - 0.04, z)
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI * 2)
    const size = 0.6 + rng() * 0.8 + smoothstep(edge, edge + 6, lateral) * 0.3
    s.set(size, size * (0.8 + rng() * 0.5), size)
    matrices.push(m.compose(p, q, s).clone())
    colors.push(green.clone().lerp(dry, rng() ** 1.5))
  }

  const mesh = new THREE.InstancedMesh(tuft, material, matrices.length)
  matrices.forEach((mat, i) => {
    mesh.setMatrixAt(i, mat)
    mesh.setColorAt(i, colors[i])
  })
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  mesh.name = 'grass'

  return {
    mesh,
    update: (elapsed: number) => {
      uniforms.uTime.value = elapsed
    },
  }
}

function buildTuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const w = 0.75
  const h = 0.55
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI
    const dx = Math.cos(a) * w * 0.5
    const dz = Math.sin(a) * w * 0.5
    const lean = 0.08
    const tl = [-dx - dz * lean, h, -dz + dx * lean]
    const tr = [dx - dz * lean, h, dz + dx * lean]
    const bl = [-dx, 0, -dz]
    const br = [dx, 0, dz]
    pos.push(...bl, ...br, ...tl, ...tl, ...br, ...tr)
    uv.push(0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const normals = new Float32Array(pos.length)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return geo
}

function createGrassTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const rng = mulberry32(5)
  for (let i = 0; i < 110; i++) {
    const x = 10 + rng() * (w - 20)
    const bh = h * (0.45 + rng() * 0.55)
    const bend = (rng() - 0.5) * 40
    const bw = 2 + rng() * 3
    const g = Math.floor(70 + rng() * 80)
    const yellow = rng() > 0.75
    ctx.fillStyle = yellow
      ? `rgb(${Math.floor(g * 1.25)},${Math.floor(g * 1.1)},${Math.floor(g * 0.45)})`
      : `rgb(${Math.floor(g * 0.6)},${g},${Math.floor(g * 0.32)})`
    ctx.beginPath()
    ctx.moveTo(x - bw, h)
    ctx.quadraticCurveTo(x - bw * 0.5 + bend * 0.3, h - bh * 0.5, x + bend, h - bh)
    ctx.quadraticCurveTo(x + bw * 0.5 + bend * 0.3, h - bh * 0.5, x + bw, h)
    ctx.closePath()
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

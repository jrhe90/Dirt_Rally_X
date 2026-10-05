import * as THREE from 'three'
import { RIBBON_OFFSETS, WALL, type Track } from '../track'
import type { GameAssets } from './assets'
import { createSplatMaterial } from './splatMaterial'

export function createRoad(track: Track, assets: GameAssets): THREE.Group {
  const group = new THREE.Group()
  group.name = 'road'
  group.add(createSurface(track, assets))
  group.add(createLines(track))
  group.add(createWalls(track, assets))
  group.add(createMarkerPosts(track))
  group.add(createStartGate(track))
  return group
}

function createSurface(track: Track, assets: GameAssets): THREE.Mesh {
  const cols = RIBBON_OFFSETS.length
  const rows = track.ribbonRows
  const n = track.count
  const count = rows * cols
  const uvs = new Float32Array(count * 2)
  const splat = new Float32Array(count * 3)
  const lateral = new Float32Array(count)

  for (let r = 0; r < rows; r++) {
    const s = track.sample(r % n)
    const tarmac = track.tarmacWeight(s.distance)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      uvs[i * 2] = track.ribbonPositions[i * 3]
      uvs[i * 2 + 1] = track.ribbonPositions[i * 3 + 2]
      lateral[i] = RIBBON_OFFSETS[c]
      const shoulder = c === 0 || c === cols - 1
      splat[i * 3] = shoulder ? 0.15 * (1 - tarmac) : 1 - tarmac
      splat[i * 3 + 1] = shoulder ? 0 : tarmac
      splat[i * 3 + 2] = shoulder ? 0.85 + 0.15 * tarmac : 0
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(track.ribbonPositions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 3))
  geo.setAttribute('lateral', new THREE.BufferAttribute(lateral, 1))
  geo.setIndex(new THREE.BufferAttribute(track.ribbonIndices, 1))
  geo.computeVertexNormals()

  const { rocky_trail_02: gravel, asphalt_02: asphalt, forrest_ground_01: ground } = assets.pbr
  const material = createSplatMaterial(
    [
      { ...gravel, scale: 1 / 3 },
      { ...asphalt, scale: 1 / 4 },
      { ...ground, scale: 1 / 2.5 },
    ],
    { ruts: true },
  )
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -1

  const mesh = new THREE.Mesh(geo, material)
  mesh.receiveShadow = true
  return mesh
}

/** Painted edge lines and a dashed center line on the tarmac section. */
function createLines(track: Track): THREE.Mesh {
  const positions: number[] = []
  const [start, end] = track.wallRange
  const quad = (i: number, offset: number, width: number) => {
    const a = track.sample(i)
    const b = track.sample(i + 1)
    const corner = (s: typeof a, o: number) => [
      s.position.x + s.binormal.x * o,
      s.position.y + 0.012,
      s.position.z + s.binormal.z * o,
    ]
    const a0 = corner(a, offset - width / 2)
    const a1 = corner(a, offset + width / 2)
    const b0 = corner(b, offset - width / 2)
    const b1 = corner(b, offset + width / 2)
    positions.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
  }

  for (let i = start - 4; i < end + 4; i++) {
    quad(i, track.halfWidth - 0.35, 0.14)
    quad(i, -(track.halfWidth - 0.35), 0.14)
    if (Math.floor(i / 3) % 2 === 0) quad(i, 0, 0.12)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0xd8d4c8,
      roughness: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  )
  mesh.receiveShadow = true
  return mesh
}

/** Dry-stone parapets with a mortared coping along both sides of the tarmac section. */
function createWalls(track: Track, assets: GameAssets): THREE.Group {
  const group = new THREE.Group()
  const [start, end] = track.wallRange
  const stone = assets.pbr.old_stone_wall

  const wallGeo = new THREE.BufferGeometry()
  const capGeo = new THREE.BufferGeometry()
  const wall: { pos: number[]; uv: number[] } = { pos: [], uv: [] }
  const cap: { pos: number[]; uv: number[] } = { pos: [], uv: [] }

  const pushStrip = (
    target: { pos: number[]; uv: number[] },
    side: number,
    profile: [number, number][],
    texScale: number,
  ) => {
    // profile: (lateral offset from wall center, height relative to road), walked so faces point outward.
    for (let i = start; i < end; i++) {
      const a = track.sample(i)
      const b = track.sample(i + 1)
      const da = (i - start) * track.spacing
      const db = da + track.spacing
      for (let k = 0; k < profile.length - 1; k++) {
        const [la, ha] = profile[k]
        const [lb, hb] = profile[k + 1]
        const p = (s: typeof a, lat: number, h: number) => {
          const o = side * (WALL.offset + lat)
          return [s.position.x + s.binormal.x * o, s.position.y + h, s.position.z + s.binormal.z * o]
        }
        const vA = p(a, la, ha)
        const vB = p(a, lb, hb)
        const vC = p(b, la, ha)
        const vD = p(b, lb, hb)
        const flip = side < 0
        const tri = flip ? [vA, vB, vC, vC, vB, vD] : [vA, vC, vB, vB, vC, vD]
        target.pos.push(...tri.flat())
        const va = (k === 0 ? 0 : profile.slice(0, k).reduce((s, _, j) => s + Math.hypot(profile[j + 1][0] - profile[j][0], profile[j + 1][1] - profile[j][1]), 0))
        const vb = va + Math.hypot(lb - la, hb - ha)
        const uvA = [da * texScale, va * texScale]
        const uvB = [da * texScale, vb * texScale]
        const uvC = [db * texScale, va * texScale]
        const uvD = [db * texScale, vb * texScale]
        const uvs = flip ? [uvA, uvB, uvC, uvC, uvB, uvD] : [uvA, uvC, uvB, uvB, uvC, uvD]
        target.uv.push(...uvs.flat())
      }
    }
  }

  const t = WALL.thickness / 2
  const h = WALL.height
  const f = -WALL.footing
  for (const side of [-1, 1]) {
    pushStrip(wall, side, [[-t, f], [-t, h - 0.1], [t, h - 0.1], [t, f]], 0.5)
    pushStrip(cap, side, [[-t - 0.06, h - 0.14], [-t - 0.06, h], [t + 0.06, h], [t + 0.06, h - 0.14]], 0.8)
  }

  for (const [geo, data] of [[wallGeo, wall], [capGeo, cap]] as const) {
    geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2))
    geo.computeVertexNormals()
  }

  const wallMat = new THREE.MeshStandardMaterial({
    map: stone.diff,
    normalMap: stone.nor,
    aoMap: stone.arm,
    roughnessMap: stone.arm,
    roughness: 1,
    metalness: 0,
    color: 0xd8d0c4,
  })
  const capMat = new THREE.MeshStandardMaterial({
    map: stone.diff,
    normalMap: stone.nor,
    roughnessMap: stone.arm,
    roughness: 1,
    color: 0xb8b0a4,
  })

  for (const [geo, mat] of [[wallGeo, wallMat], [capGeo, capMat]] as const) {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

/** White roadside delineator posts with red reflectors along the gravel sections. */
function createMarkerPosts(track: Track): THREE.Group {
  const group = new THREE.Group()
  const [wallStart, wallEnd] = track.wallRange
  const spots: { pos: THREE.Vector3; yaw: number }[] = []
  const spacing = Math.round(22 / track.spacing)
  const offset = track.halfWidth + track.shoulder + 0.9

  for (let i = 30; i < track.count - 10; i += spacing) {
    if (i > wallStart - 6 && i < wallEnd + 6) continue
    const s = track.sample(i)
    for (const side of [-1, 1]) {
      spots.push({
        pos: s.position.clone().addScaledVector(s.binormal, side * offset).setY(s.position.y - 0.5),
        yaw: Math.atan2(s.tangent.x, s.tangent.z),
      })
    }
  }

  const post = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 1.2, 0.12).translate(0, 0.6, 0),
    new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.55 }),
    spots.length,
  )
  const band = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.13, 0.14, 0.13).translate(0, 1.0, 0),
    new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.35, emissive: 0x400606 }),
    spots.length,
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  spots.forEach((s, i) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw)
    m.compose(s.pos, q, one)
    post.setMatrixAt(i, m)
    band.setMatrixAt(i, m)
  })
  post.castShadow = true
  group.add(post, band)
  return group
}

function createStartGate(track: Track): THREE.Group {
  const gate = new THREE.Group()
  const start = track.sample(0)
  gate.position.copy(start.position)
  gate.rotation.y = Math.atan2(start.tangent.x, start.tangent.z)

  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4, metalness: 0.6 })
  const span = track.halfWidth + track.shoulder + 0.6

  for (const x of [-span, span]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.6, 0.35), postMat)
    post.position.set(x, 2.4, 0)
    post.castShadow = true
    gate.add(post)
  }

  const bannerTex = createBannerTexture()
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(span * 2 + 0.5, 1.2, 0.16),
    [postMat, postMat, postMat, postMat, new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.6 })],
  )
  banner.position.set(0, 4.9, 0)
  banner.castShadow = true
  gate.add(banner)

  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(track.halfWidth * 2, 0.8),
    new THREE.MeshStandardMaterial({ map: createCheckerTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }),
  )
  line.rotation.x = -Math.PI / 2
  line.position.y = 0.02
  line.receiveShadow = true
  gate.add(line)

  return gate
}

function createBannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 1024, 0)
  grad.addColorStop(0, '#0d2a6e')
  grad.addColorStop(0.5, '#1450c8')
  grad.addColorStop(1, '#0d2a6e')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1024, 64)
  ctx.fillStyle = '#ffd21f'
  ctx.fillRect(0, 54, 1024, 10)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 44px "Bebas Neue", Impact, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('KALTENBACH RALLY  ·  SS1  ·  START', 512, 29)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function createCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 16
  const ctx = canvas.getContext('2d')!
  for (let x = 0; x < 32; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#1a1a1a' : '#e8e4da'
      ctx.fillRect(x * 8, y * 8, 8, 8)
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  return tex
}

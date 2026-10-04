import * as THREE from 'three'

export type TrackSample = {
  position: THREE.Vector3
  tangent: THREE.Vector3
  normal: THREE.Vector3
  binormal: THREE.Vector3
  distance: number
}

const TRACK_HALF_WIDTH = 5.2
const TRACK_SAMPLES = 360

/** Closed rally loop with elevation and hairpins. */
function buildCenterCurve(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = []
  const lobes = [
    { r: 72, h: 0 },
    { r: 58, h: 4 },
    { r: 80, h: 1 },
    { r: 48, h: 8 },
    { r: 70, h: 2 },
    { r: 55, h: 6 },
    { r: 76, h: 0 },
    { r: 50, h: 5 },
  ]

  const n = 48
  for (let i = 0; i < n; i++) {
    const t = i / n
    const angle = t * Math.PI * 2
    const lobe = lobes[Math.floor(t * lobes.length) % lobes.length]
    const next = lobes[Math.floor(t * lobes.length + 1) % lobes.length]
    const blend = (t * lobes.length) % 1
    const radius =
      THREE.MathUtils.lerp(lobe.r, next.r, blend) +
      Math.sin(angle * 3.2) * 6 +
      Math.cos(angle * 5.1) * 3
    const height =
      THREE.MathUtils.lerp(lobe.h, next.h, blend) +
      Math.sin(angle * 2.4) * 2.8 +
      Math.cos(angle * 1.7) * 1.5

    pts.push(
      new THREE.Vector3(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius,
      ),
    )
  }

  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.35)
}

export class Track {
  readonly curve: THREE.CatmullRomCurve3
  readonly length: number
  readonly samples: TrackSample[]
  readonly halfWidth = TRACK_HALF_WIDTH
  readonly group = new THREE.Group()

  constructor(scene: THREE.Scene) {
    this.curve = buildCenterCurve()
    this.length = this.curve.getLength()
    this.samples = this.bakeSamples()
    this.buildMeshes(scene)
  }

  private bakeSamples(): TrackSample[] {
    const samples: TrackSample[] = []
    let distance = 0

    for (let i = 0; i <= TRACK_SAMPLES; i++) {
      const t = i / TRACK_SAMPLES
      const position = this.curve.getPointAt(t)
      const tangent = this.curve.getTangentAt(t).normalize()
      const up = new THREE.Vector3(0, 1, 0)
      const binormal = new THREE.Vector3().crossVectors(up, tangent).normalize()
      const normal = new THREE.Vector3().crossVectors(tangent, binormal).normalize()

      if (i > 0) {
        distance += position.distanceTo(samples[i - 1].position)
      }

      samples.push({ position, tangent, normal, binormal, distance })
    }

    return samples
  }

  sampleAtDistance(dist: number): TrackSample {
    const wrapped = ((dist % this.length) + this.length) % this.length
    const t = wrapped / this.length
    const position = this.curve.getPointAt(t)
    const tangent = this.curve.getTangentAt(t).normalize()
    const up = new THREE.Vector3(0, 1, 0)
    const binormal = new THREE.Vector3().crossVectors(up, tangent).normalize()
    const normal = new THREE.Vector3().crossVectors(tangent, binormal).normalize()
    return { position, tangent, normal, binormal, distance: wrapped }
  }

  /** Nearest centerline sample + signed lateral offset. */
  project(worldPos: THREE.Vector3): {
    sample: TrackSample
    lateral: number
    index: number
  } {
    let best = 0
    let bestDist = Infinity

    for (let i = 0; i < this.samples.length - 1; i++) {
      const d = worldPos.distanceToSquared(this.samples[i].position)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }

    const sample = this.samples[best]
    const toCar = new THREE.Vector3().subVectors(worldPos, sample.position)
    const lateral = toCar.dot(sample.binormal)

    return { sample, lateral, index: best }
  }

  private buildMeshes(scene: THREE.Scene): void {
    this.group.name = 'track'

    // Dirt road ribbon
    const roadGeo = this.buildRoadGeometry(this.halfWidth, 0.05)
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x8a5a30,
      roughness: 0.95,
      metalness: 0.02,
      flatShading: true,
    })
    const road = new THREE.Mesh(roadGeo, roadMat)
    road.receiveShadow = true
    this.group.add(road)

    // Lighter center dust strip
    const stripGeo = this.buildRoadGeometry(1.1, 0.08)
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0xb8844a,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    })
    this.group.add(new THREE.Mesh(stripGeo, stripMat))

    // Soft berms / shoulders
    const bermGeo = this.buildBermGeometry()
    const bermMat = new THREE.MeshStandardMaterial({
      color: 0x6a4428,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    })
    const berms = new THREE.Mesh(bermGeo, bermMat)
    berms.receiveShadow = true
    this.group.add(berms)

    // Surrounding terrain
    this.group.add(this.buildTerrain())

    // Scenery
    this.scatterProps()

    // Start / finish banner
    this.group.add(this.buildStartGate())

    scene.add(this.group)
  }

  private buildRoadGeometry(halfWidth: number, yOffset: number): THREE.BufferGeometry {
    const segs = TRACK_SAMPLES
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    for (let i = 0; i <= segs; i++) {
      const s = this.samples[i]
      const left = s.position
        .clone()
        .addScaledVector(s.binormal, -halfWidth)
        .addScaledVector(s.normal, yOffset)
      const right = s.position
        .clone()
        .addScaledVector(s.binormal, halfWidth)
        .addScaledVector(s.normal, yOffset)

      positions.push(left.x, left.y, left.z, right.x, right.y, right.z)
      normals.push(
        s.normal.x,
        s.normal.y,
        s.normal.z,
        s.normal.x,
        s.normal.y,
        s.normal.z,
      )
      const u = (i / segs) * 40
      uvs.push(0, u, 1, u)
    }

    for (let i = 0; i < segs; i++) {
      const a = i * 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      indices.push(a, c, b, b, c, d)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    return geo
  }

  private buildBermGeometry(): THREE.BufferGeometry {
    const segs = TRACK_SAMPLES
    const positions: number[] = []
    const indices: number[] = []
    const inner = this.halfWidth
    const outer = this.halfWidth + 3.2

    for (let i = 0; i <= segs; i++) {
      const s = this.samples[i]
      const rise = 0.9 + Math.sin(i * 0.35) * 0.25

      for (const side of [-1, 1]) {
        const a = s.position
          .clone()
          .addScaledVector(s.binormal, side * inner)
          .addScaledVector(s.normal, 0.02)
        const b = s.position
          .clone()
          .addScaledVector(s.binormal, side * outer)
          .addScaledVector(s.normal, rise)
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }

    // Each sample has 4 verts: L-inner, L-outer, R-inner, R-outer
    for (let i = 0; i < segs; i++) {
      const base = i * 4
      const next = (i + 1) * 4
      indices.push(base, next, base + 1, base + 1, next, next + 1)
      indices.push(base + 2, base + 3, next + 2, base + 3, next + 3, next + 2)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }

  private buildTerrain(): THREE.Mesh {
    const size = 280
    const seg = 96
    const geo = new THREE.PlaneGeometry(size, size, seg, seg)
    geo.rotateX(-Math.PI / 2)

    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const { lateral, sample } = this.project(new THREE.Vector3(x, 0, z))
      const absLat = Math.abs(lateral)
      let y =
        Math.sin(x * 0.03) * 2.2 +
        Math.cos(z * 0.025) * 1.8 +
        Math.sin((x + z) * 0.02) * 3

      // Blend toward track height near the road
      if (absLat < 18) {
        const edge = THREE.MathUtils.smoothstep(absLat, this.halfWidth + 1, 18)
        y = THREE.MathUtils.lerp(sample.position.y - 0.4, y + sample.position.y * 0.15, edge)
        if (absLat < this.halfWidth + 0.5) {
          y = sample.position.y - 0.55
        }
      }

      pos.setY(i, y)
    }
    geo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      color: 0x5a7a38,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    })
    // Mix dirt tones into grass via vertex colors
    const colors = new Float32Array(pos.count * 3)
    const cGrass = new THREE.Color(0x6a8a40)
    const cDirt = new THREE.Color(0x8a6038)
    const cDry = new THREE.Color(0x9a7848)
    const tmp = new THREE.Color()

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const { lateral } = this.project(new THREE.Vector3(x, 0, z))
      const dirtMix = 1 - THREE.MathUtils.smoothstep(Math.abs(lateral), 6, 22)
      const dry = (Math.sin(x * 0.08) + Math.cos(z * 0.07)) * 0.5 + 0.5
      tmp.copy(cGrass).lerp(cDry, dry * 0.35).lerp(cDirt, dirtMix * 0.85)
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    mat.vertexColors = true

    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    return mesh
  }

  private scatterProps(): void {
    const treeGeo = new THREE.ConeGeometry(1.4, 5.5, 6)
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.38, 1.6, 5)
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0x3f6a30,
      roughness: 0.9,
      flatShading: true,
    })
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x6a4430,
      roughness: 1,
      flatShading: true,
    })
    const rockGeo = new THREE.DodecahedronGeometry(0.9, 0)
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x8a8070,
      roughness: 0.95,
      flatShading: true,
    })

    const rng = mulberry32(42)

    for (let i = 0; i < 140; i++) {
      const t = rng()
      const s = this.sampleAtDistance(t * this.length)
      const side = rng() > 0.5 ? 1 : -1
      const lat = this.halfWidth + 4 + rng() * 28
      if (lat < this.halfWidth + 3.5) continue

      const pos = s.position
        .clone()
        .addScaledVector(s.binormal, side * lat)
        .addScaledVector(s.normal, 0)

      // Trees
      if (rng() > 0.35) {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat)
        trunk.position.copy(pos)
        trunk.position.y += 0.7
        trunk.castShadow = true
        this.group.add(trunk)

        const crown = new THREE.Mesh(treeGeo, treeMat)
        crown.position.copy(pos)
        crown.position.y += 3.6
        crown.scale.setScalar(0.7 + rng() * 0.8)
        crown.rotation.y = rng() * Math.PI
        crown.castShadow = true
        this.group.add(crown)
      } else {
        const rock = new THREE.Mesh(rockGeo, rockMat)
        rock.position.copy(pos)
        rock.position.y += 0.35
        rock.scale.set(0.6 + rng(), 0.4 + rng() * 0.6, 0.6 + rng())
        rock.rotation.set(rng(), rng(), rng())
        rock.castShadow = true
        this.group.add(rock)
      }
    }
  }

  private buildStartGate(): THREE.Group {
    const gate = new THREE.Group()
    const start = this.samples[0]
    gate.position.copy(start.position)
    gate.position.addScaledVector(start.normal, 0.1)

    const yaw = Math.atan2(start.tangent.x, start.tangent.z)
    gate.rotation.y = yaw

    const postMat = new THREE.MeshStandardMaterial({
      color: 0xd4c4a0,
      roughness: 0.7,
    })
    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0xc4783a,
      roughness: 0.6,
      emissive: 0x3a1e0a,
      emissiveIntensity: 0.25,
    })

    for (const x of [-this.halfWidth - 0.4, this.halfWidth + 0.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5.5, 0.25), postMat)
      post.position.set(x, 2.75, 0)
      post.castShadow = true
      gate.add(post)
    }

    const banner = new THREE.Mesh(new THREE.BoxGeometry(this.halfWidth * 2 + 1.2, 0.9, 0.12), bannerMat)
    banner.position.set(0, 5.1, 0)
    gate.add(banner)

    return gate
  }
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

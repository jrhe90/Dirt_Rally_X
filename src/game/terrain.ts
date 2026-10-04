import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { naturalHeight, smoothstep, WORLD_HALF_SIZE } from './heights'
import type { Track } from './track'

const GRID = 200
const BLEND = 20
const UNDER_ROAD = 0.6

export class Terrain {
  readonly size = WORLD_HALF_SIZE * 2
  private readonly positions: Float32Array
  private readonly indices: Uint32Array
  private readonly colors: Float32Array
  private readonly track: Track

  constructor(track: Track) {
    this.track = track
    const verts = (GRID + 1) * (GRID + 1)
    this.positions = new Float32Array(verts * 3)
    this.colors = new Float32Array(verts * 3)

    const grass = new THREE.Color(0x6f8a3e)
    const dry = new THREE.Color(0xa08850)
    const dirt = new THREE.Color(0x8a6038)
    const rock = new THREE.Color(0x8a7c6a)
    const tmp = new THREE.Color()
    const step = this.size / GRID

    for (let iz = 0; iz <= GRID; iz++) {
      for (let ix = 0; ix <= GRID; ix++) {
        const x = -WORLD_HALF_SIZE + ix * step
        const z = -WORLD_HALF_SIZE + iz * step
        const { height, lateral } = this.sampleHeight(x, z)
        const v = (iz * (GRID + 1) + ix) * 3
        this.positions[v] = x
        this.positions[v + 1] = height
        this.positions[v + 2] = z

        const dryness = (Math.sin(x * 0.06) + Math.cos(z * 0.05) + Math.sin((x - z) * 0.13) * 0.5) * 0.3 + 0.5
        const dirtMix = 1 - smoothstep(track.halfWidth + track.shoulder, 18, Math.abs(lateral))
        const rockMix = smoothstep(10, 26, height) * 0.6
        tmp.copy(grass).lerp(dry, THREE.MathUtils.clamp(dryness, 0, 1) * 0.55).lerp(rock, rockMix).lerp(dirt, dirtMix * 0.9)
        this.colors[v] = tmp.r
        this.colors[v + 1] = tmp.g
        this.colors[v + 2] = tmp.b
      }
    }

    const idx: number[] = []
    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        const a = iz * (GRID + 1) + ix
        const b = a + 1
        const c = a + (GRID + 1)
        const d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    }
    this.indices = new Uint32Array(idx)
  }

  private sampleHeight(x: number, z: number): { height: number; lateral: number } {
    const proj = this.track.project(x, z)
    const lat = Math.abs(proj.lateral)
    const natural = naturalHeight(x, z)
    const edge = this.track.halfWidth + this.track.shoulder

    if (lat < edge) return { height: proj.roadHeight - UNDER_ROAD, lateral: proj.lateral }
    const t = smoothstep(edge, edge + BLEND, lat)
    return {
      height: THREE.MathUtils.lerp(proj.roadHeight - 0.45, natural, t),
      lateral: proj.lateral,
    }
  }

  /** Height of the rendered surface (road or terrain) at a world position. */
  heightAt(x: number, z: number): number {
    const proj = this.track.project(x, z)
    if (Math.abs(proj.lateral) <= this.track.halfWidth) return proj.roadHeight
    return this.sampleHeight(x, z).height
  }

  createCollider(world: RAPIER.World): RAPIER.Collider {
    const collider = world.createCollider(
      RAPIER.ColliderDesc.trimesh(this.positions, this.indices).setFriction(0.8),
    )

    const h = WORLD_HALF_SIZE
    const walls: [number, number, number, number][] = [
      [h, 0, 1, h],
      [-h, 0, 1, h],
      [0, h, h, 1],
      [0, -h, h, 1],
    ]
    for (const [x, z, hx, hz] of walls) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 60, hz).setTranslation(x, 20, z))
    }

    return collider
  }

  createMesh(): THREE.Mesh {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    geo.setIndex(new THREE.BufferAttribute(this.indices, 1))
    geo.computeVertexNormals()

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0,
        flatShading: true,
      }),
    )
    mesh.receiveShadow = true
    return mesh
  }
}

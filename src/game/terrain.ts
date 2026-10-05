import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { naturalHeight, smoothstep, WORLD_HALF_SIZE } from './heights'
import type { Track } from './track'

export const TERRAIN_GRID = 200
const BLEND = 20
const UNDER_ROAD = 0.6

export class Terrain {
  readonly size = WORLD_HALF_SIZE * 2
  readonly positions: Float32Array
  readonly indices: Uint32Array
  /** Signed distance from the track centerline per vertex. */
  readonly laterals: Float32Array
  readonly track: Track

  constructor(track: Track) {
    this.track = track
    const verts = (TERRAIN_GRID + 1) * (TERRAIN_GRID + 1)
    this.positions = new Float32Array(verts * 3)
    this.laterals = new Float32Array(verts)
    const step = this.size / TERRAIN_GRID

    for (let iz = 0; iz <= TERRAIN_GRID; iz++) {
      for (let ix = 0; ix <= TERRAIN_GRID; ix++) {
        const x = -WORLD_HALF_SIZE + ix * step
        const z = -WORLD_HALF_SIZE + iz * step
        const { height, lateral } = this.sampleHeight(x, z)
        const i = iz * (TERRAIN_GRID + 1) + ix
        this.positions[i * 3] = x
        this.positions[i * 3 + 1] = height
        this.positions[i * 3 + 2] = z
        this.laterals[i] = lateral
      }
    }

    const idx: number[] = []
    for (let iz = 0; iz < TERRAIN_GRID; iz++) {
      for (let ix = 0; ix < TERRAIN_GRID; ix++) {
        const a = iz * (TERRAIN_GRID + 1) + ix
        const b = a + 1
        const c = a + (TERRAIN_GRID + 1)
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

  /** Approximate surface normal from central differences. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = 1
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    return out.set(-dx, 2 * e, -dz).normalize()
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
}

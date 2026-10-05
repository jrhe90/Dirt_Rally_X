import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { mulberry32 } from './heights'
import type { Terrain } from './terrain'
import type { Track } from './track'

export type PlacementKind = 'tree' | 'rock' | 'outcrop'

export type Placement = {
  kind: PlacementKind
  position: THREE.Vector3
  scale: THREE.Vector3
  rotation: number
  /** Picks a model variant; renderers take it modulo their variant count. */
  variant: number
  /** 0..1 color variation. */
  tint: number
}

const ROADSIDE_ATTEMPTS = 900
const ROADSIDE_MAX = 620
const FOREST_MAX = 320
const OUTCROP_MAX = 28

export class Scenery {
  readonly placements: Placement[] = []

  constructor(track: Track, terrain: Terrain) {
    const rng = mulberry32(7)
    const clearance = track.halfWidth + track.shoulder + 4
    const normal = new THREE.Vector3()

    const sidePoint = (lateral: number) => {
      const { position, tangent } = track.pointAt(rng() * track.length)
      const side = rng() > 0.5 ? 1 : -1
      return { x: position.x + tangent.z * lateral * side, z: position.z - tangent.x * lateral * side }
    }

    let roadside = 0
    for (let i = 0; i < ROADSIDE_ATTEMPTS && roadside < ROADSIDE_MAX; i++) {
      const { x, z } = sidePoint(clearance + 1 + rng() ** 1.5 * 50)
      if (Math.hypot(x, z) > 188) continue
      if (Math.abs(track.project(x, z).lateral) < clearance) continue

      const tree = rng() > 0.18
      const s = tree ? 0.8 + rng() * 0.7 : 0.45 + rng() * 0.9
      this.placements.push({
        kind: tree ? 'tree' : 'rock',
        position: new THREE.Vector3(x, terrain.heightAt(x, z), z),
        scale: tree
          ? new THREE.Vector3(s, s * (0.9 + rng() * 0.25), s)
          : new THREE.Vector3(s * (0.8 + rng() * 0.5), s * (0.5 + rng() * 0.5), s),
        rotation: rng() * Math.PI * 2,
        variant: Math.floor(rng() * 6),
        tint: rng(),
      })
      roadside++
    }

    let forest = 0
    for (let i = 0; i < FOREST_MAX * 3 && forest < FOREST_MAX; i++) {
      const angle = rng() * Math.PI * 2
      const radius = 150 + rng() * 42
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      if (Math.abs(track.project(x, z).lateral) < clearance + 20) continue
      const s = 0.9 + rng() * 0.6
      this.placements.push({
        kind: 'tree',
        position: new THREE.Vector3(x, terrain.heightAt(x, z), z),
        scale: new THREE.Vector3(s, s * (0.9 + rng() * 0.25), s),
        rotation: rng() * Math.PI * 2,
        variant: Math.floor(rng() * 6),
        tint: rng(),
      })
      forest++
    }

    let outcrops = 0
    for (let i = 0; i < 400 && outcrops < OUTCROP_MAX; i++) {
      const r = 2.2 + rng() * 3.4
      const { x, z } = sidePoint(clearance + r + 2 + rng() * 30)
      if (Math.hypot(x, z) > 185) continue
      if (Math.abs(track.project(x, z).lateral) < clearance + r) continue
      terrain.normalAt(x, z, normal)
      if (normal.y > 0.985 && rng() > 0.25) continue

      this.placements.push({
        kind: 'outcrop',
        position: new THREE.Vector3(x, terrain.heightAt(x, z) - r * 0.25, z),
        scale: new THREE.Vector3(r, r * (0.7 + rng() * 0.6), r * (0.8 + rng() * 0.4)),
        rotation: rng() * Math.PI * 2,
        variant: Math.floor(rng() * 6),
        tint: rng(),
      })
      outcrops++
    }
  }

  createColliders(world: RAPIER.World): void {
    for (const p of this.placements) {
      if (p.kind === 'tree') {
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(1.5, 0.32 * p.scale.x).setTranslation(p.position.x, p.position.y + 1.5, p.position.z),
        )
      } else {
        const r = 0.8 * Math.max(p.scale.x, p.scale.z)
        const top = p.position.y + 0.85 * p.scale.y
        world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(p.position.x, top - r, p.position.z))
      }
    }
  }
}

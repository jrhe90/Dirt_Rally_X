import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { mulberry32 } from './heights'
import type { Terrain } from './terrain'
import type { Track } from './track'

type Placement = {
  kind: 'tree' | 'rock'
  position: THREE.Vector3
  scale: THREE.Vector3
  rotation: number
}

export class Scenery {
  private readonly placements: Placement[] = []

  constructor(track: Track, terrain: Terrain) {
    const rng = mulberry32(7)
    const clearance = track.halfWidth + track.shoulder + 4

    for (let i = 0; i < 420 && this.placements.length < 340; i++) {
      const { position, tangent } = track.pointAt(rng() * track.length)
      const side = rng() > 0.5 ? 1 : -1
      const lateral = clearance + 1 + rng() ** 1.6 * 45
      const x = position.x + tangent.z * lateral * side
      const z = position.z - tangent.x * lateral * side
      if (Math.hypot(x, z) > 185) continue
      if (Math.abs(track.project(x, z).lateral) < clearance) continue

      const tree = rng() > 0.25
      const s = tree ? 0.75 + rng() * 0.7 : 0.6 + rng() * 1.1
      this.placements.push({
        kind: tree ? 'tree' : 'rock',
        position: new THREE.Vector3(x, terrain.heightAt(x, z), z),
        scale: tree ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s * (0.8 + rng() * 0.5), s * (0.5 + rng() * 0.4), s),
        rotation: rng() * Math.PI * 2,
      })
    }
  }

  createColliders(world: RAPIER.World): void {
    for (const p of this.placements) {
      if (p.kind === 'tree') {
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(1.5, 0.32 * p.scale.x).setTranslation(p.position.x, p.position.y + 1.5, p.position.z),
        )
      } else {
        const r = 0.85 * Math.max(p.scale.x, p.scale.z)
        world.createCollider(
          RAPIER.ColliderDesc.ball(r).setTranslation(p.position.x, p.position.y + r * 0.35, p.position.z),
        )
      }
    }
  }

  createMeshes(): THREE.Group {
    const group = new THREE.Group()
    const trees = this.placements.filter((p) => p.kind === 'tree')
    const rocks = this.placements.filter((p) => p.kind === 'rock')

    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.26, 0.36, 2.2, 6).translate(0, 1.1, 0),
      new THREE.MeshStandardMaterial({ color: 0x6a4430, roughness: 1, flatShading: true }),
      trees.length,
    )
    const crownLow = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.9, 3.6, 7).translate(0, 3.6, 0),
      new THREE.MeshStandardMaterial({ color: 0x3d6630, roughness: 0.9, flatShading: true }),
      trees.length,
    )
    const crownHigh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.3, 2.8, 7).translate(0, 5.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x4a7a38, roughness: 0.9, flatShading: true }),
      trees.length,
    )
    const rock = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.9, 0),
      new THREE.MeshStandardMaterial({ color: 0x8e8474, roughness: 0.95, flatShading: true }),
      rocks.length,
    )

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    trees.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rotation)
      m.compose(p.position, q, p.scale)
      trunk.setMatrixAt(i, m)
      crownLow.setMatrixAt(i, m)
      crownHigh.setMatrixAt(i, m)
    })
    rocks.forEach((p, i) => {
      q.setFromEuler(new THREE.Euler(p.rotation * 0.3, p.rotation, p.rotation * 0.7))
      m.compose(p.position.clone().setY(p.position.y + 0.2), q, p.scale)
      rock.setMatrixAt(i, m)
    })

    for (const mesh of [trunk, crownLow, crownHigh, rock]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
    return group
  }
}

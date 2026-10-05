import * as THREE from 'three'
import { smoothstep } from '../heights'
import type { Terrain } from '../terrain'
import type { GameAssets } from './assets'
import { createSplatMaterial } from './splatMaterial'

export function createTerrainMesh(terrain: Terrain, assets: GameAssets): THREE.Mesh {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(terrain.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(terrain.indices, 1))
  geo.computeVertexNormals()

  const count = terrain.positions.length / 3
  const normals = geo.getAttribute('normal')
  const uvs = new Float32Array(count * 2)
  const splat = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const edge = terrain.track.halfWidth + terrain.track.shoulder

  for (let i = 0; i < count; i++) {
    const x = terrain.positions[i * 3]
    const y = terrain.positions[i * 3 + 1]
    const z = terrain.positions[i * 3 + 2]
    uvs[i * 2] = x
    uvs[i * 2 + 1] = z

    const lat = Math.abs(terrain.laterals[i])
    const slope = 1 - normals.getY(i)
    const patch = Math.sin(x * 0.11 + Math.cos(z * 0.07) * 2) * Math.cos(z * 0.09 - x * 0.03) * 0.5 + 0.5
    const verge = THREE.MathUtils.clamp(1 - smoothstep(edge - 1, edge + 7 + patch * 6, lat) + smoothstep(0.72, 0.95, patch) * 0.6, 0, 1)
    const rock = THREE.MathUtils.clamp(smoothstep(0.12, 0.3, slope) + smoothstep(20, 30, y) * 0.7, 0, 1) * smoothstep(edge + 2, edge + 8, lat)

    splat[i * 3] = (1 - verge) * (1 - rock)
    splat[i * 3 + 1] = verge * (1 - rock)
    splat[i * 3 + 2] = rock

    const dry = THREE.MathUtils.clamp((Math.sin(x * 0.05) + Math.cos(z * 0.043) + Math.sin((x - z) * 0.11) * 0.5) * 0.35 + 0.5, 0, 1)
    colors[i * 3] = 0.92 + dry * 0.2
    colors[i * 3 + 1] = 0.95 + dry * 0.08
    colors[i * 3 + 2] = 0.9 - dry * 0.12
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const { aerial_grass_rock: grass, forrest_ground_01: ground, cliff_side: cliff } = assets.pbr
  const material = createSplatMaterial(
    [
      { ...grass, scale: 1 / 4 },
      { ...ground, scale: 1 / 2.5 },
      { ...cliff, scale: 1 / 7, tint: new THREE.Color(0.72, 0.8, 0.9) },
    ],
    { vertexColors: true },
  )

  const mesh = new THREE.Mesh(geo, material)
  mesh.receiveShadow = true
  mesh.name = 'terrain'
  return mesh
}

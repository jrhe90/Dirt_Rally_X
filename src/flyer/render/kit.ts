import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type MaterialKey = 'paint' | 'matte' | 'glass' | 'glow'

export type Materials = Record<MaterialKey, THREE.Material>

/** Shared vertex-coloured materials, so every prop merges into at most four draw calls. */
export function createMaterials(envMap: THREE.Texture): Materials {
  return {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25, envMap, envMapIntensity: 0.9 }),
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05, envMap, envMapIntensity: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.9, envMap, envMapIntensity: 1.2 }),
    // Vertex colours above 1 drive the bloom.
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
  }
}

type Color = readonly [number, number, number]

export const glow = (c: Color, intensity: number): Color => [c[0] * intensity, c[1] * intensity, c[2] * intensity]

/** Collects coloured primitives per material and merges them into one mesh per material. */
export class Kit {
  private readonly parts = new Map<MaterialKey, THREE.BufferGeometry[]>()

  add(key: MaterialKey, geometry: THREE.BufferGeometry, color: Color, matrix?: THREE.Matrix4): void {
    let g = geometry.index ? geometry.toNonIndexed() : geometry
    if (g === geometry) g = geometry.clone()
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    if (matrix) g.applyMatrix4(matrix)
    const count = g.attributes.position.count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) colors.set(color, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const list = this.parts.get(key) ?? []
    list.push(g)
    this.parts.set(key, list)
  }

  box(key: MaterialKey, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: Color): void {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    this.add(key, g, color)
  }

  /**
   * Eight-cornered solid: corners 0–3 are the bottom face and 4–7 the top, each going
   * (-x,-z), (+x,-z), (+x,+z), (-x,+z). Lets tapered cabs and wedges stay one primitive.
   */
  hexa(key: MaterialKey, corners: readonly (readonly [number, number, number])[], color: Color): void {
    const faces = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ]
    const center = new THREE.Vector3()
    for (const c of corners) center.add(new THREE.Vector3(...c))
    center.divideScalar(8)
    const positions: number[] = []
    const v = corners.map((c) => new THREE.Vector3(...c))
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()
    for (const [a, b, c, d] of faces) {
      ab.subVectors(v[b], v[a])
      ac.subVectors(v[c], v[a])
      const normal = new THREE.Vector3().crossVectors(ab, ac)
      const faceCenter = v[a].clone().add(v[b]).add(v[c]).add(v[d]).multiplyScalar(0.25)
      const outward = normal.dot(faceCenter.sub(center)) >= 0
      const tris = outward ? [a, b, c, a, c, d] : [a, c, b, a, d, c]
      for (const i of tris) positions.push(v[i].x, v[i].y, v[i].z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.computeVertexNormals()
    this.add(key, g, color)
  }

  /** Cylinder along `axis` between two points. */
  cylinder(key: MaterialKey, from: THREE.Vector3, to: THREE.Vector3, radius: number, color: Color, segments = 12): void {
    const dir = new THREE.Vector3().subVectors(to, from)
    const g = new THREE.CylinderGeometry(radius, radius, dir.length(), segments)
    const m = new THREE.Matrix4().compose(
      from.clone().add(to).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
      new THREE.Vector3(1, 1, 1),
    )
    this.add(key, g, color, m)
  }

  sphere(key: MaterialKey, x: number, y: number, z: number, radius: number, color: Color, segments = 16): void {
    const g = new THREE.SphereGeometry(radius, segments, Math.max(6, segments >> 1))
    g.translate(x, y, z)
    this.add(key, g, color)
  }

  build(materials: Materials): THREE.Group {
    const group = new THREE.Group()
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false)
      if (!merged) continue
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, materials[key])
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    return group
  }
}

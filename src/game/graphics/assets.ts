import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'

export const PBR_IDS = [
  'rocky_trail_02',
  'asphalt_02',
  'forrest_ground_01',
  'aerial_grass_rock',
  'cliff_side',
  'old_stone_wall',
  'bark_brown_02',
] as const

export type PbrId = (typeof PBR_IDS)[number]

export type PbrSet = {
  diff: THREE.Texture
  nor: THREE.Texture
  /** Packed ambient occlusion (r), roughness (g), metalness (b). */
  arm: THREE.Texture
}

export type GameAssets = {
  pbr: Record<PbrId, PbrSet>
  hdr: THREE.DataTexture
  rocks: THREE.BufferGeometry[]
  rockMaterial: THREE.MeshStandardMaterial
}

const BASE = `${import.meta.env.BASE_URL}assets/`

export async function loadAssets(
  renderer: THREE.WebGLRenderer,
  onProgress: (loaded: number, total: number) => void,
): Promise<GameAssets> {
  const manager = new THREE.LoadingManager()
  manager.onProgress = (_url, loaded, total) => onProgress(loaded, total)

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const textureLoader = new THREE.TextureLoader(manager)

  const loadTexture = async (url: string, srgb: boolean) => {
    const tex = await textureLoader.loadAsync(url)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = anisotropy
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    return tex
  }

  const loadSet = async (id: PbrId): Promise<[PbrId, PbrSet]> => {
    const dir = `${BASE}textures/${id}/${id}`
    const [diff, nor, arm] = await Promise.all([
      loadTexture(`${dir}_diff.jpg`, true),
      loadTexture(`${dir}_nor_gl.jpg`, false),
      loadTexture(`${dir}_arm.jpg`, false),
    ])
    return [id, { diff, nor, arm }]
  }

  const [sets, hdr, gltf] = await Promise.all([
    Promise.all(PBR_IDS.map(loadSet)),
    new HDRLoader(manager).loadAsync(`${BASE}hdri/alps_field.hdr`),
    new GLTFLoader(manager).loadAsync(`${BASE}models/rock_moss_set_01/rock_moss_set_01.gltf`),
  ])

  const meshes: THREE.Mesh[] = []
  gltf.scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh)
  })
  if (meshes.length === 0) throw new Error('Rock models are missing from the asset pack')
  const rocks = meshes.map((mesh) => normalizeRock(mesh.geometry))
  const rockMaterial = meshes[0].material as THREE.MeshStandardMaterial

  for (const tex of [rockMaterial.map, rockMaterial.normalMap, rockMaterial.roughnessMap]) {
    if (tex) tex.anisotropy = anisotropy
  }

  return { pbr: Object.fromEntries(sets) as Record<PbrId, PbrSet>, hdr, rocks, rockMaterial }
}

/** Centers the rock on its footprint, rests it on y = 0 and scales its horizontal radius to 1. */
function normalizeRock(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = source.clone()
  geo.computeBoundingBox()
  const box = geo.boundingBox!
  const center = box.getCenter(new THREE.Vector3())
  geo.translate(-center.x, -box.min.y, -center.z)
  const size = box.getSize(new THREE.Vector3())
  const s = 2 / Math.max(size.x, size.z)
  geo.scale(s, s, s)
  geo.computeBoundingSphere()
  return geo
}

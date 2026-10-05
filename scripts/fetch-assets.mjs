/**
 * Downloads the CC0 textures, HDRI and models from Poly Haven into public/assets.
 * Run with `npm run fetch-assets`. Files are committed, so this is only needed to refresh or add assets.
 */
import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const OUT = new URL('../public/assets/', import.meta.url).pathname
const API = 'https://api.polyhaven.com/files/'

const TEXTURES = [
  ['rocky_trail_02', '2k'],
  ['asphalt_02', '2k'],
  ['forrest_ground_01', '1k'],
  ['aerial_grass_rock', '1k'],
  ['cliff_side', '1k'],
  ['old_stone_wall', '1k'],
  ['bark_brown_02', '1k'],
]
const TEXTURE_MAPS = { diff: 'Diffuse', nor_gl: 'nor_gl', arm: 'arm' }
const HDRIS = [['alps_field', '2k']]
const MODELS = [['rock_moss_set_01', '1k']]

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function download(url, path) {
  if (await exists(path)) return
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  console.log('fetched', path.replace(OUT, ''))
}

async function manifest(id) {
  const res = await fetch(API + id)
  if (!res.ok) throw new Error(`${res.status} manifest ${id}`)
  return res.json()
}

for (const [id, res] of TEXTURES) {
  const files = await manifest(id)
  for (const [name, key] of Object.entries(TEXTURE_MAPS)) {
    await download(files[key][res].jpg.url, join(OUT, 'textures', id, `${id}_${name}.jpg`))
  }
}

for (const [id, res] of HDRIS) {
  const files = await manifest(id)
  await download(files.hdri[res].hdr.url, join(OUT, 'hdri', `${id}.hdr`))
}

for (const [id, res] of MODELS) {
  const gltf = (await manifest(id)).gltf[res].gltf
  await download(gltf.url, join(OUT, 'models', id, `${id}.gltf`))
  for (const [rel, file] of Object.entries(gltf.include)) {
    await download(file.url, join(OUT, 'models', id, rel))
  }
}

console.log('assets ready in public/assets')

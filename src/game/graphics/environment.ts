import * as THREE from 'three'
import type { Quality } from './quality'

export type Environment = {
  sun: THREE.DirectionalLight
  sunDirection: THREE.Vector3
  follow: (target: THREE.Vector3) => void
}

/** Image-based lighting and background from the HDRI, plus a shadow-casting sun aligned with it. */
export function createEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  hdr: THREE.DataTexture,
  quality: Quality,
): Environment {
  hdr.mapping = THREE.EquirectangularReflectionMapping
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromEquirectangular(hdr).texture
  pmrem.dispose()
  scene.background = hdr
  scene.environmentIntensity = 0.75
  scene.backgroundIntensity = 0.85

  const { direction: sunDirection, horizon } = analyzeHdr(hdr)
  const fogColor = horizon.multiplyScalar(0.85)
  scene.fog = new THREE.FogExp2(fogColor, 0.0032)

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
  const extent = quality.tier === 'high' ? 55 : 40
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 220
  sun.shadow.camera.left = -extent
  sun.shadow.camera.right = extent
  sun.shadow.camera.top = extent
  sun.shadow.camera.bottom = -extent
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.04
  sun.shadow.radius = 2
  scene.add(sun, sun.target)

  const texel = (extent * 2) / quality.shadowMapSize
  const offset = sunDirection.clone().multiplyScalar(110)
  return {
    sun,
    sunDirection,
    follow: (target) => {
      // Snap to shadow-map texels so shadow edges do not shimmer as the car moves.
      const x = Math.round(target.x / texel) * texel
      const z = Math.round(target.z / texel) * texel
      sun.target.position.set(x, target.y, z)
      sun.position.set(x + offset.x, target.y + offset.y, z + offset.z)
    },
  }
}

/** Finds the sun as the brightest region of the HDRI and averages the sky just above the horizon. */
function analyzeHdr(hdr: THREE.DataTexture): { direction: THREE.Vector3; horizon: THREE.Color } {
  const { width, height, data } = hdr.image as { width: number; height: number; data: ArrayLike<number> }
  const half = hdr.type === THREE.HalfFloatType
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i])
  const channels = data.length / (width * height)

  let best = -1
  let bestX = 0
  let bestY = 0
  const horizon = new THREE.Color(0, 0, 0)
  let horizonSamples = 0
  const step = 4

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels
      const r = read(i)
      const g = read(i + 1)
      const b = read(i + 2)
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
      if (lum > best) {
        best = lum
        bestX = x
        bestY = y
      }
      // Rows are stored top-down: v runs from 1 at the zenith to 0 at the nadir.
      const v = 1 - y / height
      if (v > 0.53 && v < 0.6) {
        horizon.r += Math.min(r, 4)
        horizon.g += Math.min(g, 4)
        horizon.b += Math.min(b, 4)
        horizonSamples++
      }
    }
  }
  horizon.multiplyScalar(1 / Math.max(1, horizonSamples))

  const u = bestX / width
  const v = 1 - bestY / height
  const lat = (v - 0.5) * Math.PI
  const lon = (u - 0.5) * Math.PI * 2
  const direction = new THREE.Vector3(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat)).normalize()
  if (direction.y < 0.25) direction.setY(0.25).normalize()

  // Color is in linear working space already; keep it as-is.
  return { direction, horizon }
}

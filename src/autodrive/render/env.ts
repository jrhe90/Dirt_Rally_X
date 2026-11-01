import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'

/**
 * Golden-hour light over the coast: a Preetham sky with the sun a few degrees above the sea,
 * ahead and to the right of the road, a warm shadow-casting sun that follows the car, a cool
 * hemisphere fill, and an environment map captured from the sky for the car paint and glass.
 */

export const SUN_ELEVATION = THREE.MathUtils.degToRad(6)
export const SUN_AZIMUTH = THREE.MathUtils.degToRad(46)
/** Direction toward the sun (world). Forward along the road is roughly +x; the sea is toward +z. */
export const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
).normalize()

/** The light comes from a little higher than the visible sun, so shadows stay readable. */
export const LIGHT_DIR = new THREE.Vector3(SUN_DIR.x, 0.46, SUN_DIR.z).normalize()

export const FOG_COLOR = new THREE.Color(0.62, 0.47, 0.4)
export const HORIZON_COLOR = new THREE.Color(1.0, 0.62, 0.36)
export const ZENITH_COLOR = new THREE.Color(0.2, 0.3, 0.5)

/** The Preetham sky is in raw radiance units; bring it into the range the rest of the scene is lit for. */
const SKY_SCALE = 0.2

function configureSky(sky: Sky, disc: boolean): void {
  sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', `vec3 skyC = texColor * ${SKY_SCALE.toFixed(3)}; skyC = skyC / (1.0 + max(skyC - 1.2, 0.0) * 0.35); gl_FragColor = vec4( min(skyC, vec3(4.0)), 1.0 );`)
  sky.material.needsUpdate = true
  const u = sky.material.uniforms
  u.turbidity.value = 10
  u.rayleigh.value = 1.6
  u.mieCoefficient.value = 0.009
  u.mieDirectionalG.value = 0.88
  u.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000)
  if (u.cloudCoverage) {
    u.cloudCoverage.value = 0.32
    u.cloudDensity.value = 0.55
    u.cloudElevation.value = 0.6
    u.cloudScale.value = 0.00018
  }
  if (u.showSunDisc) u.showSunDisc.value = disc ? 1 : 0
}

export class Environment {
  readonly sky: Sky
  readonly sun: THREE.DirectionalLight
  readonly hemi: THREE.HemisphereLight
  readonly envMap: THREE.Texture
  private readonly target = new THREE.Object3D()

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadowSize: number) {
    this.sky = new Sky()
    this.sky.scale.setScalar(20000)
    configureSky(this.sky, true)
    this.sky.frustumCulled = false
    scene.add(this.sky)

    // Reflections: the same sky without the disc (the sun light handles the highlight).
    const envScene = new THREE.Scene()
    const envSky = new Sky()
    envSky.scale.setScalar(1000)
    configureSky(envSky, false)
    envScene.add(envSky)
    // A dark ground so the lower half of reflections isn't sky-bright.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(400, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.09, 0.075, 0.065) }),
    )
    ground.position.y = -2
    envScene.add(ground)
    const pmrem = new THREE.PMREMGenerator(renderer)
    this.envMap = pmrem.fromScene(envScene, 0.02).texture
    pmrem.dispose()
    scene.environment = this.envMap
    scene.environmentIntensity = 1.1

    this.sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.74, 0.5), 2.9)
    this.sun.castShadow = shadowSize > 0
    if (shadowSize > 0) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize)
      const cam = this.sun.shadow.camera
      cam.left = -55
      cam.right = 55
      cam.top = 55
      cam.bottom = -55
      cam.near = 1
      cam.far = 400
      this.sun.shadow.bias = -0.0006
      this.sun.shadow.normalBias = 0.22
    }
    this.sun.target = this.target
    scene.add(this.sun, this.target)

    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.62, 0.85), new THREE.Color(0.36, 0.26, 0.19), 1.1)
    scene.add(this.hemi)

    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0011)
  }

  /** Keep the shadow frustum centered just ahead of the car. */
  follow(x: number, y: number, z: number, camera: THREE.Camera): void {
    const snap = 2
    const cx = Math.round(x / snap) * snap
    const cz = Math.round(z / snap) * snap
    this.target.position.set(cx, y, cz)
    this.sun.position.set(cx + LIGHT_DIR.x * 200, y + LIGHT_DIR.y * 200, cz + LIGHT_DIR.z * 200)
    this.sky.position.copy(camera.position)
  }
}

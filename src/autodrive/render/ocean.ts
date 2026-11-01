import * as THREE from 'three'
import { FOG_COLOR, HORIZON_COLOR, SUN_DIR, ZENITH_COLOR } from './env'
import { fbm } from './noise'

/**
 * The sea: a large plane at sea level that follows the camera. The fragment shader builds a
 * wave normal from a few travelling sine octaves, reflects the view ray into a sunset sky
 * gradient, adds a glitter path toward the low sun, and fades into the haze.
 */
const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSun;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uFog;
  uniform vec3 uDeep;
  uniform float uFogDensity;
  varying vec3 vWorld;

  vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
    float ph = dot(p, dir) * freq + uTime * speed;
    return dir * cos(ph) * amp * freq;
  }

  void main() {
    vec2 p = vWorld.xz;
    vec2 g = vec2(0.0);
    g += wave(p, normalize(vec2(0.8, 0.6)), 0.045, 1.1, 0.5);
    g += wave(p, normalize(vec2(-0.3, 1.0)), 0.11, 1.7, 0.18);
    g += wave(p, normalize(vec2(1.0, -0.2)), 0.27, 2.6, 0.06);
    g += wave(p, normalize(vec2(0.4, 0.9)), 0.63, 3.9, 0.022);
    g += wave(p, normalize(vec2(-0.9, 0.4)), 1.31, 5.3, 0.009);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 view = normalize(vWorld - cameraPosition);
    float dist = length(vWorld - cameraPosition);
    // Flatten far away so the horizon doesn't sparkle.
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0), clamp(dist / 2600.0, 0.0, 0.85)));
    vec3 r = reflect(view, n);
    float up = clamp(r.y, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(up, 0.45));
    float sunAmt = max(dot(r, uSun), 0.0);
    sky += vec3(1.0, 0.62, 0.32) * (pow(sunAmt, 24.0) * 0.45 + pow(sunAmt, 700.0) * 7.0);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-view, n), 0.0), 5.0);
    vec3 water = uDeep * (0.6 + 0.4 * max(dot(n, uSun), 0.0));
    vec3 col = mix(water, sky, fres);
    float fog = 1.0 - exp(-pow(uFogDensity * dist * 0.8, 2.0));
    col = mix(col, uFog, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`

export class Ocean {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSun: { value: SUN_DIR.clone() },
        uHorizon: { value: HORIZON_COLOR.clone().multiplyScalar(0.75) },
        uZenith: { value: ZENITH_COLOR.clone() },
        uFog: { value: FOG_COLOR.clone() },
        uDeep: { value: new THREE.Color(0.012, 0.05, 0.075) },
        uFogDensity: { value: 0.0011 },
      },
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1).rotateX(-Math.PI / 2), this.material)
    this.mesh.position.y = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
    scene.add(this.mesh)
  }

  update(camera: THREE.Camera, time: number): void {
    this.mesh.position.x = Math.round(camera.position.x / 50) * 50
    this.mesh.position.z = Math.round(camera.position.z / 50) * 50
    this.material.uniforms.uTime.value = time
  }
}

/**
 * Hazy ridgelines inland (toward -z), far beyond the terrain chunks, as a ring of jagged
 * silhouettes that follows the camera.
 */
export class Backdrop {
  readonly group = new THREE.Group()

  constructor(scene: THREE.Scene) {
    const layers = [
      { radius: 3600, height: 520, color: new THREE.Color(0.42, 0.33, 0.36), seed: 1 },
      { radius: 2600, height: 330, color: new THREE.Color(0.33, 0.25, 0.25), seed: 2 },
    ]
    for (const layer of layers) {
      const segments = 220
      const pos: number[] = []
      const idx: number[] = []
      // Inland arc: from the road's rear-left round to the front-left, fading out toward the sea.
      const a0 = Math.PI * 0.05
      const a1 = Math.PI * 0.95
      for (let i = 0; i <= segments; i++) {
        const t = i / segments
        const a = a0 + (a1 - a0) * t
        const fade = Math.sin(t * Math.PI) ** 0.6
        const h = layer.height * fade * (0.35 + 0.9 * fbm(t * 14 + layer.seed * 10, layer.seed, 5))
        const x = Math.cos(a) * layer.radius
        const z = -Math.sin(a) * layer.radius
        pos.push(x, -40, z, x, h, z)
        if (i < segments) {
          const k = i * 2
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setIndex(idx)
      const m = new THREE.MeshBasicMaterial({ color: layer.color, fog: false, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(g, m)
      mesh.frustumCulled = false
      mesh.renderOrder = -2
      this.group.add(mesh)
    }
    scene.add(this.group)
  }

  update(camera: THREE.Camera): void {
    this.group.position.set(camera.position.x, 0, camera.position.z)
  }
}

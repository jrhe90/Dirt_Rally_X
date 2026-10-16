import * as THREE from 'three'
import { glow, Kit, type Materials } from './kit'

/**
 * The night highway: a wet-looking asphalt road with a centre line, guard rails, floodlight
 * towers on the far side throwing pools of light, and a city skyline on the horizon. Everything
 * here follows the camera, snapping to its repeat length so the scrolling is seamless.
 */

export const ROAD_HALF_WIDTH = 7
const ROAD_PERIOD = 16
const ROAD_LENGTH = 560
const TOWER_SPACING = 64
const TOWER_Z = -12.5
const TOWER_COUNT = 9
const TOWER_HEIGHT = 15
export const FOG_COLOR = new THREE.Color(0x06080c)

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function roadTexture(): THREE.CanvasTexture {
  // u runs along the road (16 m), v across it (16 m: 14 m of road plus shoulders).
  const texture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#1d2024'
    ctx.fillRect(0, 0, 512, 512)
    const image = ctx.getImageData(0, 0, 512, 512)
    for (let i = 0; i < image.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26
      image.data[i] += n
      image.data[i + 1] += n
      image.data[i + 2] += n + 2
    }
    ctx.putImageData(image, 0, 0)
    const m = 512 / 16
    // Darker polished wheel tracks.
    ctx.fillStyle = 'rgba(0,0,0,0.22)'
    for (const z of [-4.6, -2.6, 2.6, 4.6]) ctx.fillRect(0, (8 + z - 0.45) * m, 512, 0.9 * m)
    // Shoulders.
    ctx.fillStyle = '#15171a'
    ctx.fillRect(0, 0, 512, 1 * m)
    ctx.fillRect(0, 15 * m, 512, 1 * m)
    // Solid edge lines and a dashed centre line.
    ctx.fillStyle = '#d9dde2'
    ctx.fillRect(0, 1.25 * m, 512, 0.18 * m)
    ctx.fillRect(0, 14.57 * m, 512, 0.18 * m)
    for (let x = 0; x < 16; x += 8) ctx.fillRect(x * m, 7.9 * m, 4.5 * m, 0.2 * m)
  })
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

function groundTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#0e1012'
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2600; i++) {
      const v = 10 + Math.random() * 20
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 1})`
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
    }
  })
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

function poolTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
  })
}

function skylineTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(2048, 256, (ctx) => {
    ctx.clearRect(0, 0, 2048, 256)
    let x = 0
    while (x < 2048) {
      const w = 30 + Math.random() * 90
      const h = 30 + Math.random() * 170 * (Math.random() < 0.15 ? 1.3 : 0.7)
      ctx.fillStyle = '#07090d'
      ctx.fillRect(x, 256 - h, w, h)
      for (let wy = 256 - h + 6; wy < 250; wy += 9) {
        for (let wx = x + 4; wx < x + w - 4; wx += 7) {
          if (Math.random() < 0.22) {
            ctx.fillStyle = Math.random() < 0.7 ? 'rgba(255,196,120,0.75)' : 'rgba(170,210,255,0.7)'
            ctx.fillRect(wx, wy, 3, 4)
          }
        }
      }
      if (h > 150 && Math.random() < 0.6) {
        ctx.fillStyle = '#ff2a2a'
        ctx.fillRect(x + w / 2 - 2, 256 - h - 6, 4, 4)
      }
      x += w + Math.random() * 14
    }
  })
  texture.wrapS = THREE.RepeatWrapping
  return texture
}

/** A dark gradient sky with a few bright panels, prefiltered for reflections on the cars. */
export function createEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene()
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir; void main(){ float h = vDir.y; vec3 c = mix(vec3(0.05,0.055,0.06), vec3(0.03,0.045,0.08), smoothstep(-0.1, 0.6, h)); c += vec3(0.12,0.1,0.09) * exp(-abs(h) * 14.0); gl_FragColor = vec4(c, 1.0); }`,
    }),
  )
  scene.add(sky)
  const panel = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7.4, 8) })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const light = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), panel)
    light.position.set(Math.cos(a) * 30, 18 + (i % 2) * 6, Math.sin(a) * 30)
    light.lookAt(0, 0, 0)
    scene.add(light)
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(scene, 0.03).texture
  pmrem.dispose()
  return texture
}

function buildTower(materials: Materials): THREE.Group {
  const kit = new Kit()
  const steel = [0.16, 0.17, 0.19] as const
  kit.cylinder('matte', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, TOWER_HEIGHT, 0), 0.2, steel, 10)
  kit.box('matte', -0.6, 0.6, 0, 0.5, -0.6, 0.6, [0.25, 0.25, 0.26])
  kit.box('matte', -1.9, 1.9, TOWER_HEIGHT - 0.1, TOWER_HEIGHT + 0.15, -0.2, 0.2, steel)
  for (const x of [-1.5, -0.5, 0.5, 1.5]) {
    kit.box('matte', x - 0.42, x + 0.42, TOWER_HEIGHT + 0.15, TOWER_HEIGHT + 0.9, -0.25, 0.25, [0.1, 0.1, 0.11])
    // Lamp faces point at the road (+z).
    kit.box('glow', x - 0.36, x + 0.36, TOWER_HEIGHT + 0.22, TOWER_HEIGHT + 0.83, 0.25, 0.28, glow([0.92, 0.96, 1], 12))
  }
  return kit.build(materials)
}

export class World {
  readonly group = new THREE.Group()
  private readonly road: THREE.Mesh
  private readonly ground: THREE.Mesh
  private readonly rails: THREE.Group
  private readonly towers: THREE.Group[] = []
  private readonly pools: THREE.Mesh[] = []
  private readonly skyline: THREE.Mesh
  private readonly lamps: THREE.PointLight[] = []

  constructor(scene: THREE.Scene, materials: Materials) {
    scene.background = FOG_COLOR
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0105)
    scene.add(this.group)

    scene.add(new THREE.HemisphereLight(0x33405c, 0x0b0c0e, 0.9))
    const moon = new THREE.DirectionalLight(0x9fb0d0, 0.45)
    moon.position.set(-20, 40, 30)
    scene.add(moon)

    const roadTex = roadTexture()
    roadTex.repeat.set(ROAD_LENGTH / ROAD_PERIOD, 1)
    const roadGeometry = new THREE.PlaneGeometry(ROAD_LENGTH, 16)
    roadGeometry.rotateX(-Math.PI / 2)
    this.road = new THREE.Mesh(
      roadGeometry,
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.25 }),
    )
    this.group.add(this.road)

    const groundTex = groundTexture()
    groundTex.repeat.set(160, 60)
    const groundGeometry = new THREE.PlaneGeometry(1600, 600)
    groundGeometry.rotateX(-Math.PI / 2)
    this.ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }))
    this.ground.position.y = -0.03
    this.group.add(this.ground)

    const railKit = new Kit()
    for (const z of [-ROAD_HALF_WIDTH - 1.1, ROAD_HALF_WIDTH + 1.1]) {
      railKit.box('paint', -ROAD_LENGTH / 2, ROAD_LENGTH / 2, 0.55, 0.85, z - 0.06, z + 0.06, [0.45, 0.47, 0.5])
      railKit.box('glow', -ROAD_LENGTH / 2, ROAD_LENGTH / 2, 0.68, 0.72, z + (z > 0 ? -0.07 : 0.07) - 0.01, z + (z > 0 ? -0.07 : 0.07) + 0.01, glow([1, 0.35, 0.1], 0.6))
      for (let x = -ROAD_LENGTH / 2; x < ROAD_LENGTH / 2; x += 4) railKit.box('matte', x - 0.08, x + 0.08, 0, 0.75, z - 0.08, z + 0.08, [0.2, 0.2, 0.22])
    }
    this.rails = railKit.build(materials)
    this.group.add(this.rails)

    const tower = buildTower(materials)
    const poolMaterial = new THREE.MeshBasicMaterial({
      map: poolTexture(),
      color: new THREE.Color(0.26, 0.29, 0.34),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
    const poolGeometry = new THREE.PlaneGeometry(30, 22)
    poolGeometry.rotateX(-Math.PI / 2)
    for (let i = 0; i < TOWER_COUNT; i++) {
      const t = tower.clone()
      this.towers.push(t)
      this.group.add(t)
      const pool = new THREE.Mesh(poolGeometry, poolMaterial)
      pool.position.set(0, 0.02, -2.5)
      pool.renderOrder = 1
      this.pools.push(pool)
      this.group.add(pool)
    }

    for (let i = 0; i < 3; i++) {
      const lamp = new THREE.PointLight(0xe4ecff, 650, 70, 2)
      this.lamps.push(lamp)
      scene.add(lamp)
    }

    const skylineTex = skylineTexture()
    skylineTex.repeat.set(3, 1)
    this.skyline = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 70),
      new THREE.MeshBasicMaterial({ map: skylineTex, transparent: true, fog: false, color: new THREE.Color(0.42, 0.42, 0.46) }),
    )
    this.skyline.position.set(0, 22, -520)
    this.group.add(this.skyline)

    const horizon = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 260),
      new THREE.ShaderMaterial({
        fog: false,
        depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 vUv; void main(){ float h = vUv.y; vec3 top = vec3(0.012,0.016,0.03); vec3 glow = vec3(0.09,0.075,0.08); gl_FragColor = vec4(mix(glow, top, smoothstep(0.0, 0.55, h)), 1.0); }`,
      }),
    )
    horizon.position.set(0, 100, -560)
    horizon.renderOrder = -1
    this.group.add(horizon)
    this.horizon = horizon
  }

  private readonly horizon: THREE.Mesh

  /** Keep everything around the camera; `focusX` is the car. */
  update(cameraX: number, focusX: number): void {
    this.road.position.x = Math.floor(cameraX / ROAD_PERIOD) * ROAD_PERIOD + ROAD_LENGTH * 0.25
    this.rails.position.x = Math.floor(cameraX / 4) * 4 + ROAD_LENGTH * 0.25
    this.ground.position.x = Math.floor(cameraX / 10) * 10
    this.skyline.position.x = cameraX * 0.92
    this.horizon.position.x = cameraX

    const first = Math.floor((cameraX - TOWER_SPACING * 2) / TOWER_SPACING)
    for (let i = 0; i < TOWER_COUNT; i++) {
      const x = (first + i) * TOWER_SPACING
      this.towers[i].position.set(x, 0, TOWER_Z)
      this.pools[i].position.x = x
    }
    // The real lights sit in the three towers nearest the car; the rest only have light pools.
    const nearest = Math.round(focusX / TOWER_SPACING) * TOWER_SPACING
    this.lamps.forEach((lamp, i) => lamp.position.set(nearest + (i - 1) * TOWER_SPACING, TOWER_HEIGHT, TOWER_Z + 1.5))
  }
}

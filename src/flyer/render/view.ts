import * as THREE from 'three'
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing'
import type { SimEvent, SimState } from '../sim/types'
import { CameraRig } from './camera'
import { CarView } from './carView'
import { createMaterials } from './kit'
import { Particles } from './particles'
import { Props, Shadows } from './props'
import { createEnvironmentMap, World } from './world'

export type QualityTier = 'low' | 'high'

export function detectTier(): QualityTier {
  const param = new URLSearchParams(window.location.search).get('quality')
  if (param === 'low' || param === 'high') return param
  return window.matchMedia('(pointer: coarse)').matches ? 'low' : 'high'
}

/** Everything that draws: scene, post-processing, the car, obstacles, particles and the camera. */
export class GameView {
  readonly renderer: THREE.WebGLRenderer
  readonly rig = new CameraRig()
  private readonly scene = new THREE.Scene()
  private readonly composer: EffectComposer
  private readonly world: World
  private readonly props: Props
  private readonly shadows: Shadows
  private readonly carView: CarView
  private readonly smoke: Particles
  private readonly sparks: Particles
  private readonly projected = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement, tier: QualityTier) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'high' ? 2 : 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping

    const envMap = createEnvironmentMap(this.renderer)
    const materials = createMaterials(envMap)
    this.world = new World(this.scene, materials)
    this.shadows = new Shadows(this.scene)
    this.props = new Props(this.scene, materials, this.shadows)
    this.smoke = new Particles(tier === 'high' ? 1400 : 700, 'smoke')
    this.sparks = new Particles(400, 'glow')
    this.scene.add(this.smoke.mesh, this.sparks.mesh)
    this.carView = new CarView(this.scene, materials, this.smoke, this.sparks)

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera))
    const bloom = new BloomEffect({
      intensity: 1.1,
      luminanceThreshold: 0.75,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.75,
      resolutionScale: tier === 'high' ? 0.5 : 0.35,
    })
    const effects = [bloom, new ToneMappingEffect({ mode: ToneMappingMode.AGX }), new VignetteEffect({ offset: 0.3, darkness: 0.55 })]
    this.composer.addPass(new EffectPass(this.rig.camera, ...effects))
    if (tier === 'high') this.composer.addPass(new EffectPass(this.rig.camera, new SMAAEffect()))
    this.resize()
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.rig.resize(w, h)
  }

  reset(): void {
    this.props.reset()
    this.smoke.clear()
    this.sparks.clear()
    this.carView.reset()
  }

  handleEvents(events: readonly SimEvent[], s: SimState): void {
    for (const e of events) {
      this.carView.handleEvent(e, s)
      if (e.type === 'crash') this.rig.shake(0.85)
      else if (e.type === 'bounce') this.rig.shake(Math.min(0.5, e.impact / 25))
      else if (e.type === 'land') this.rig.shake(Math.min(0.35, e.impact / 40))
      else if (e.type === 'nearMiss') this.rig.shake(0.12)
      else if (e.type === 'interceptorLaunch') this.rig.shake(0.08)
    }
  }

  /** Screen position (CSS px) of a world point on the road plane. */
  project(x: number, y: number): { x: number; y: number } {
    this.projected.set(x, y, 0).project(this.rig.camera)
    return { x: (this.projected.x * 0.5 + 0.5) * window.innerWidth, y: (-this.projected.y * 0.5 + 0.5) * window.innerHeight }
  }

  frame(s: SimState, dt: number, realDt: number): void {
    this.rig.update(s, realDt)
    const camX = this.rig.camera.position.x
    this.world.update(camX, s.car.x)
    this.shadows.begin()
    this.carView.update(s, dt, this.shadows)
    this.props.update(s, this.rig.camera, s.car.x - 45, s.car.x + 190)
    this.shadows.end()
    this.smoke.update(dt)
    this.sparks.update(dt)
    this.composer.render(realDt)
  }
}

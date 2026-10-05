import * as THREE from 'three'
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import type { Quality } from './quality'

export class PostFx {
  private readonly composer: EffectComposer
  private readonly ao: N8AOPostPass | null = null

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality) {
    renderer.toneMapping = THREE.NoToneMapping
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(scene, camera))

    if (quality.ambientOcclusion) {
      const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight)
      ao.configuration.aoRadius = 1.6
      ao.configuration.distanceFalloff = 0.6
      ao.configuration.intensity = 2.2
      ao.configuration.halfRes = true
      ao.configuration.depthAwareUpsampling = true
      ao.setQualityMode('Medium')
      this.composer.addPass(ao)
      this.ao = ao
    }

    const bloom = new BloomEffect({
      intensity: 0.55,
      luminanceThreshold: 0.92,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
      radius: 0.7,
    })
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX })
    const contrast = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.1 })
    const saturation = new HueSaturationEffect({ saturation: 0.16 })
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.5 })

    this.composer.addPass(new EffectPass(camera, bloom, toneMapping, contrast, saturation, vignette))
    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: quality.tier === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })))
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height)
  }

  render(dt: number): void {
    this.composer.render(dt)
  }

  get hasAmbientOcclusion(): boolean {
    return this.ao !== null
  }
}

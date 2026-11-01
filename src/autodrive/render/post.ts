import * as THREE from 'three'
import { BloomEffect, BlendFunction, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing'

/**
 * Post-processing for the hot-pursuit look: strong bloom on lights and sun glints, a radial
 * speed blur with chromatic fringing that grows with speed, filmic tone mapping, an
 * orange-and-teal grade, and a vignette.
 */

const SPEED_FRAG = /* glsl */ `
  uniform float strength;
  uniform float fringe;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 c = vec2(0.5, 0.55);
    vec2 dir = uv - c;
    float r = length(dir);
    float k = strength * smoothstep(0.12, 0.75, r);
    if (k < 0.001 && fringe < 0.001) { outputColor = inputColor; return; }
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++) {
      float t = float(i) / 9.0;
      vec2 o = dir * k * 0.075 * t;
      vec2 f = dir * fringe * r * 0.012;
      acc.r += texture2D(inputBuffer, uv - o + f).r;
      acc.g += texture2D(inputBuffer, uv - o).g;
      acc.b += texture2D(inputBuffer, uv - o - f).b;
    }
    outputColor = vec4(acc / 10.0, inputColor.a);
  }
`

class SpeedEffect extends Effect {
  constructor() {
    super('SpeedEffect', SPEED_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['strength', new THREE.Uniform(0)],
        ['fringe', new THREE.Uniform(0)],
      ]),
    })
  }
  set(strength: number, fringe: number): void {
    this.uniforms.get('strength')!.value = strength
    this.uniforms.get('fringe')!.value = fringe
  }
}

const GRADE_FRAG = /* glsl */ `
  uniform float flash;
  uniform vec3 tint;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Teal shadows, warm highlights.
    vec3 shadows = vec3(0.9, 0.99, 1.08);
    vec3 highs = vec3(1.1, 1.0, 0.84);
    c *= mix(shadows, highs, smoothstep(0.1, 0.7, l));
    c = mix(vec3(l), c, 1.14);
    c = (c - 0.5) * 1.06 + 0.5;
    c = mix(c, tint, flash);
    outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
  }
`

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['flash', new THREE.Uniform(0)],
        ['tint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
      ]),
    })
  }
  set(flash: number, tint: THREE.Color): void {
    this.uniforms.get('flash')!.value = flash
    ;(this.uniforms.get('tint')!.value as THREE.Color).copy(tint)
  }
}

export class Post {
  readonly composer: EffectComposer
  private readonly speed = new SpeedEffect()
  private readonly grade = new GradeEffect()
  private flash = 0
  private readonly flashColor = new THREE.Color(1, 1, 1)

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, high: boolean) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(scene, camera))
    const bloom = new BloomEffect({
      intensity: 1.1,
      luminanceThreshold: 1.25,
      luminanceSmoothing: 0.3,
      mipmapBlur: true,
      radius: 0.78,
      resolutionScale: high ? 0.5 : 0.35,
    })
    this.composer.addPass(new EffectPass(camera, bloom))
    this.composer.addPass(new EffectPass(camera, this.speed))
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
    this.composer.addPass(new EffectPass(camera, tone, this.grade, new VignetteEffect({ offset: 0.28, darkness: 0.62 })))
    if (high) this.composer.addPass(new EffectPass(camera, new SMAAEffect()))
  }

  /** Screen flash (camera flash, crash). */
  pulse(amount: number, color: THREE.Color): void {
    this.flash = Math.max(this.flash, amount)
    this.flashColor.copy(color)
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h)
  }

  render(speed: number, dt: number): void {
    const kmh = speed * 3.6
    const s = THREE.MathUtils.clamp((kmh - 90) / 170, 0, 1)
    this.speed.set(s * s * 0.9, s * 1.2)
    this.flash = Math.max(0, this.flash - dt * 3)
    this.grade.set(this.flash, this.flashColor)
    this.composer.render(dt)
  }
}

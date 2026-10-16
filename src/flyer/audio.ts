import { AudioEngine } from '../game/audio/engine'
import { Music } from '../game/audio/music'
import type { SimEvent, SimState } from './sim/types'

/** Pentatonic steps for the rising cell-pickup chime. */
const CELL_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]

/**
 * All of the game's sound, synthesized: jet hiss and rumble that follow the spool, an EV whine
 * on the road, wind, crash scrape, the interceptor siren, and one-shots for pickups, near misses,
 * rolls, landings, lasers and crashes. The rally rock soundtrack is reused from the main game,
 * with intensity rising over the run.
 */
export class FlyerAudio {
  readonly engine: AudioEngine
  private readonly music: Music
  private readonly ctx: AudioContext
  private readonly jetHiss: GainNode
  private readonly jetFilter: BiquadFilterNode
  private readonly jetRumble: GainNode
  private readonly wind: GainNode
  private readonly scrape: GainNode
  private readonly whine: OscillatorNode
  private readonly whineGain: GainNode
  private readonly siren: OscillatorNode
  private readonly sirenGain: GainNode
  private sirenOn = false
  private started = false

  constructor() {
    this.engine = new AudioEngine()
    this.ctx = this.engine.ctx
    this.music = new Music(this.engine)
    this.engine.pauseWhenHidden()

    const noise = () => {
      const src = this.ctx.createBufferSource()
      src.buffer = this.engine.noise
      src.loop = true
      src.loopStart = Math.random()
      src.start()
      return src
    }

    this.jetFilter = this.ctx.createBiquadFilter()
    this.jetFilter.type = 'bandpass'
    this.jetFilter.Q.value = 0.7
    this.jetHiss = this.gain(0)
    noise().connect(this.jetFilter).connect(this.jetHiss).connect(this.engine.sfx)

    const rumbleFilter = this.ctx.createBiquadFilter()
    rumbleFilter.type = 'lowpass'
    rumbleFilter.frequency.value = 170
    this.jetRumble = this.gain(0)
    noise().connect(rumbleFilter).connect(this.jetRumble).connect(this.engine.sfx)

    const windFilter = this.ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 480
    windFilter.Q.value = 0.5
    this.wind = this.gain(0)
    noise().connect(windFilter).connect(this.wind).connect(this.engine.sfx)

    const scrapeFilter = this.ctx.createBiquadFilter()
    scrapeFilter.type = 'highpass'
    scrapeFilter.frequency.value = 1900
    this.scrape = this.gain(0)
    noise().connect(scrapeFilter).connect(this.scrape).connect(this.engine.sfx)

    this.whine = this.ctx.createOscillator()
    this.whine.type = 'sine'
    this.whineGain = this.gain(0)
    this.whine.connect(this.whineGain).connect(this.engine.sfx)
    this.whine.start()

    this.siren = this.ctx.createOscillator()
    this.siren.type = 'triangle'
    this.sirenGain = this.gain(0)
    this.siren.connect(this.sirenGain).connect(this.engine.sfx)
    this.siren.start()
  }

  private gain(value: number): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = value
    return g
  }

  /** Call from a user gesture. */
  start(): void {
    this.engine.unlock()
    if (!this.started) {
      this.started = true
      this.music.start()
    }
  }

  setMuted(muted: boolean): void {
    this.engine.setMuted(muted)
  }

  setMusic(on: boolean): void {
    this.engine.setMusicEnabled(on)
  }

  update(s: SimState): void {
    const now = this.ctx.currentTime
    const c = s.car
    const crashed = !!c.crash
    const jet = crashed ? 0 : Math.max(c.spool, c.flare ? 0.8 : 0)
    const set = (p: AudioParam, v: number, tc = 0.04) => p.setTargetAtTime(v, now, tc)
    set(this.jetHiss.gain, jet * 0.42)
    set(this.jetFilter.frequency, 900 + jet * 900 + Math.max(0, c.vy) * 40)
    set(this.jetRumble.gain, jet * 0.75)
    const speed = s.phase === 'over' ? 0 : c.vx
    set(this.wind.gain, Math.min(1, speed / 30) * (c.grounded ? 0.05 : 0.11), 0.2)
    set(this.whineGain.gain, c.grounded && !crashed && s.phase !== 'ready' ? 0.035 : s.phase === 'ready' ? 0.02 : 0, 0.08)
    set(this.whine.frequency, 240 + speed * 16, 0.1)
    set(this.scrape.gain, crashed && c.crash!.grounded ? Math.min(1, c.crash!.vx / 18) * 0.3 : 0, 0.05)

    const warning = s.obstacles.some((o) => o.kind === 'interceptor' && o.state === 'warn')
    if (warning !== this.sirenOn) {
      this.sirenOn = warning
      set(this.sirenGain.gain, warning ? 0.07 : 0, 0.03)
    }
    if (warning) this.siren.frequency.setValueAtTime(Math.floor(now / 0.17) % 2 ? 920 : 690, now)

    const distance = Math.max(0, c.x - s.startX)
    this.music.setIntensity(s.phase === 'ready' ? 0.25 : crashed ? 0.2 : 0.5 + 0.5 * Math.min(1, distance / 1500))
  }

  /** Title screen: the attract-mode car stays silent, only the music plays. */
  idle(): void {
    const now = this.ctx.currentTime
    for (const g of [this.jetHiss, this.jetRumble, this.wind, this.scrape, this.whineGain, this.sirenGain]) g.gain.setTargetAtTime(0, now, 0.1)
    this.sirenOn = false
    this.music.setIntensity(0.25)
  }

  handle(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'cell': {
          const step = CELL_STEPS[Math.min(e.chain, CELL_STEPS.length - 1)]
          const f = 880 * 2 ** (step / 12)
          this.tone(f, 0.09, 'triangle', 0.12)
          this.tone(f * 2, 0.06, 'sine', 0.05)
          break
        }
        case 'nearMiss':
          this.whoosh(0.35, 2600, 600, 0.32)
          break
        case 'rollStart':
          this.whoosh(0.5, 700, 2400, 0.22)
          break
        case 'roll':
        case 'rollDodge':
          this.tone(1320, 0.1, 'triangle', 0.1)
          this.tone(1760, 0.14, 'triangle', 0.08, 0.07)
          break
        case 'land':
          this.thump(Math.min(1, e.impact / 14) * 0.5)
          if (e.clean) [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.09, i * 0.06))
          break
        case 'takeoff':
          this.whoosh(0.35, 300, 1600, 0.25)
          break
        case 'crash':
          this.crash(1)
          break
        case 'bounce':
          this.crash(Math.min(0.6, e.impact / 20))
          break
        case 'laserWarn':
          for (let i = 0; i < 3; i++) this.tone(1480, 0.07, 'square', 0.05, i * 0.16)
          break
        case 'laserFire':
          this.buzz(1.0)
          break
        case 'interceptorLaunch':
          this.flyby()
          break
        default:
          break
      }
    }
  }

  private tone(freq: number, duration: number, type: OscillatorType, level: number, delay = 0): void {
    const t = this.ctx.currentTime + 0.005 + delay
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(g).connect(this.engine.sfx)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }

  private noiseBurst(duration: number, type: BiquadFilterType, f0: number, f1: number, level: number, q = 0.8): void {
    const t = this.ctx.currentTime + 0.005
    const src = this.ctx.createBufferSource()
    src.buffer = this.engine.noise
    src.loopStart = Math.random()
    const filter = this.ctx.createBiquadFilter()
    filter.type = type
    filter.Q.value = q
    filter.frequency.setValueAtTime(f0, t)
    filter.frequency.exponentialRampToValueAtTime(f1, t + duration)
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + Math.min(0.06, duration * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    src.connect(filter).connect(g).connect(this.engine.sfx)
    src.start(t, Math.random())
    src.stop(t + duration + 0.05)
  }

  private whoosh(duration: number, f0: number, f1: number, level: number): void {
    this.noiseBurst(duration, 'bandpass', f0, f1, level, 1.2)
  }

  private thump(level: number): void {
    const t = this.ctx.currentTime + 0.005
    const osc = this.ctx.createOscillator()
    osc.frequency.setValueAtTime(110, t)
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.2)
    const g = this.gain(0)
    g.gain.setValueAtTime(level, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    osc.connect(g).connect(this.engine.sfx)
    osc.start(t)
    osc.stop(t + 0.3)
  }

  private crash(level: number): void {
    this.thump(level)
    this.noiseBurst(0.7 * level + 0.2, 'lowpass', 3000, 300, 0.6 * level)
    for (const f of [523, 787, 1131, 1477]) this.tone(f * (0.97 + Math.random() * 0.06), 0.35 * level + 0.1, 'square', 0.025 * level)
  }

  private buzz(duration: number): void {
    const t = this.ctx.currentTime + 0.005
    const osc = this.ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 98
    const lfo = this.ctx.createOscillator()
    lfo.frequency.value = 22
    const lfoGain = this.gain(0.05)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1400
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.12, t + 0.03)
    g.gain.setValueAtTime(0.12, t + duration - 0.08)
    g.gain.linearRampToValueAtTime(0, t + duration)
    lfo.connect(lfoGain).connect(g.gain)
    osc.connect(filter).connect(g).connect(this.engine.sfx)
    osc.start(t)
    lfo.start(t)
    osc.stop(t + duration + 0.02)
    lfo.stop(t + duration + 0.02)
  }

  private flyby(): void {
    const t = this.ctx.currentTime + 0.005
    const osc = this.ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(340, t)
    osc.frequency.exponentialRampToValueAtTime(110, t + 1.3)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.1, t + 0.9)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
    osc.connect(filter).connect(g).connect(this.engine.sfx)
    osc.start(t)
    osc.stop(t + 1.45)
    this.noiseBurst(1.3, 'bandpass', 600, 2400, 0.2)
  }
}

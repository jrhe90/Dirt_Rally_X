import { AudioEngine } from '../game/audio/engine'
import { Music } from '../game/audio/music'
import type { Autopilot } from './sim/fsd/autopilot'
import { heatLevel, isChasing } from './sim/police'
import type { SimEvent, SimState } from './sim/types'

/**
 * Synthesized sound: a dual-motor EV whine and inverter tone that follow speed and load, road
 * roar and wind, tyre squeal past the grip limit, police sirens (wail far away, yelp up close)
 * from the nearest interceptor, impacts, near-miss whooshes, and the autopilot's chimes:
 * engage, disengage, lane-change ticking and the take-over alarm. The rock soundtrack from the
 * rally game rises with the heat.
 */
export class AutoAudio {
  readonly engine: AudioEngine
  private readonly ctx: AudioContext
  private readonly music: Music
  private readonly motor: OscillatorNode
  private readonly motor2: OscillatorNode
  private readonly motorGain: GainNode
  private readonly inverter: OscillatorNode
  private readonly inverterGain: GainNode
  private readonly road: GainNode
  private readonly roadFilter: BiquadFilterNode
  private readonly wind: GainNode
  private readonly squeal: GainNode
  private readonly siren: OscillatorNode
  private readonly sirenGain: GainNode
  private readonly sirenFilter: BiquadFilterNode
  private started = false
  private lastTick = 0
  private alarmAt = 0

  constructor() {
    this.engine = new AudioEngine()
    this.ctx = this.engine.ctx
    this.music = new Music(this.engine)
    this.engine.pauseWhenHidden()
    const ctx = this.ctx
    const noise = () => {
      const src = ctx.createBufferSource()
      src.buffer = this.engine.noise
      src.loop = true
      src.loopStart = Math.random()
      src.start()
      return src
    }

    this.motorGain = this.gain(0)
    const motorFilter = ctx.createBiquadFilter()
    motorFilter.type = 'lowpass'
    motorFilter.frequency.value = 2200
    this.motor = ctx.createOscillator()
    this.motor.type = 'sawtooth'
    this.motor2 = ctx.createOscillator()
    this.motor2.type = 'triangle'
    this.motor.connect(motorFilter)
    this.motor2.connect(motorFilter)
    motorFilter.connect(this.motorGain).connect(this.engine.sfx)
    this.motor.start()
    this.motor2.start()

    this.inverter = ctx.createOscillator()
    this.inverter.type = 'sine'
    this.inverterGain = this.gain(0)
    this.inverter.connect(this.inverterGain).connect(this.engine.sfx)
    this.inverter.start()

    this.roadFilter = ctx.createBiquadFilter()
    this.roadFilter.type = 'lowpass'
    this.roadFilter.frequency.value = 400
    this.road = this.gain(0)
    noise().connect(this.roadFilter).connect(this.road).connect(this.engine.sfx)

    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 700
    windFilter.Q.value = 0.4
    this.wind = this.gain(0)
    noise().connect(windFilter).connect(this.wind).connect(this.engine.sfx)

    const squealFilter = ctx.createBiquadFilter()
    squealFilter.type = 'bandpass'
    squealFilter.frequency.value = 1900
    squealFilter.Q.value = 6
    this.squeal = this.gain(0)
    noise().connect(squealFilter).connect(this.squeal).connect(this.engine.sfx)

    this.siren = ctx.createOscillator()
    this.siren.type = 'square'
    this.sirenFilter = ctx.createBiquadFilter()
    this.sirenFilter.type = 'lowpass'
    this.sirenFilter.frequency.value = 2400
    this.sirenGain = this.gain(0)
    this.siren.connect(this.sirenFilter).connect(this.sirenGain).connect(this.engine.sfx)
    this.siren.start()
  }

  private gain(v: number): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = v
    return g
  }

  start(): void {
    this.engine.unlock()
    if (!this.started) {
      this.started = true
      this.music.start()
    }
  }

  setMuted(m: boolean): void {
    this.engine.setMuted(m)
  }

  setMusic(on: boolean): void {
    this.engine.setMusicEnabled(on)
  }

  update(sim: SimState, ap: Autopilot, paused: boolean): void {
    const now = this.ctx.currentTime
    const e = sim.ego
    const set = (p: AudioParam, v: number, tc = 0.05) => p.setTargetAtTime(v, now, tc)
    const v = paused ? 0 : Math.abs(e.v)
    const load = Math.max(0, Math.min(1, Math.abs(e.accel) / 6))
    set(this.motor.frequency, 60 + v * 11)
    set(this.motor2.frequency, 120 + v * 22)
    set(this.motorGain.gain, paused ? 0 : 0.012 + load * 0.05 + Math.min(1, v / 60) * 0.02)
    set(this.inverter.frequency, 1800 + v * 38)
    set(this.inverterGain.gain, paused ? 0 : 0.004 + load * 0.012)
    set(this.road.gain, Math.min(1, v / 50) * 0.22)
    set(this.roadFilter.frequency, 250 + v * 9)
    set(this.wind.gain, Math.min(1, (v / 70) ** 2) * 0.25, 0.2)
    set(this.squeal.gain, paused ? 0 : Math.min(1, e.slip) * 0.12, 0.04)

    // Nearest chasing cop's siren.
    let nearest = Infinity
    for (const a of sim.agents) {
      if (!isChasing(a) && a.role !== 'block') continue
      const d = Math.hypot(a.s - e.s, a.d - e.d)
      nearest = Math.min(nearest, d)
    }
    const audible = !paused && nearest < 400
    set(this.sirenGain.gain, audible ? 0.05 * Math.min(1, 40 / (nearest + 20)) + 0.004 : 0, 0.1)
    if (audible) {
      const close = nearest < 45
      const f = close ? (Math.floor(now * 7) % 2 ? 1450 : 900) : 750 + 520 * (0.5 - 0.5 * Math.cos((now / 3.2) * Math.PI * 2))
      this.siren.frequency.setTargetAtTime(f, now, close ? 0.01 : 0.05)
    }

    // Lane-change indicator tick.
    if (!paused && e.signal !== 0 && now - this.lastTick > 0.38) {
      this.lastTick = now
      this.click(Math.floor(now / 0.38) % 2 ? 2400 : 1900)
    }
    // Take-over alarm.
    if (!paused && ap.status.takeover && now > this.alarmAt) {
      this.alarmAt = now + 0.5
      this.tone(1046, 0.16, 'square', 0.08)
      this.tone(1046, 0.16, 'square', 0.08, 0.22)
    }
    const heat = sim.pursuit ? heatLevel(sim) : 0
    this.music.setIntensity(paused ? 0.15 : Math.min(1, 0.35 + heat * 0.13 + Math.min(1, v / 60) * 0.15))
  }

  silence(): void {
    const now = this.ctx.currentTime
    for (const g of [this.motorGain, this.inverterGain, this.road, this.wind, this.squeal, this.sirenGain]) g.gain.setTargetAtTime(0, now, 0.1)
    this.music.setIntensity(0.25)
  }

  engaged(on: boolean): void {
    if (on) {
      this.tone(880, 0.12, 'sine', 0.12)
      this.tone(1320, 0.18, 'sine', 0.12, 0.11)
    } else {
      this.tone(1320, 0.12, 'sine', 0.12)
      this.tone(784, 0.22, 'sine', 0.12, 0.11)
    }
  }

  chime(): void {
    this.tone(1568, 0.09, 'sine', 0.07)
  }

  handle(events: readonly SimEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'collision':
          this.crash(Math.min(1, ev.impact / 12))
          break
        case 'barrier':
          this.crash(Math.min(0.6, ev.impact / 10))
          break
        case 'nearMiss':
          this.whoosh(0.4)
          break
        case 'speedcam':
          this.tone(2600, 0.05, 'square', 0.06)
          break
        case 'spiked':
          this.crash(0.7)
          break
        case 'pursuit':
          this.tone(392, 0.25, 'sawtooth', 0.06)
          this.tone(523, 0.35, 'sawtooth', 0.06, 0.2)
          break
        case 'escaped':
          ;[523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.09, i * 0.09))
          break
        case 'busted':
          ;[392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.08, i * 0.18))
          break
        case 'copWrecked':
          this.crash(0.8)
          ;[784, 1046].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.08, 0.15 + i * 0.08))
          break
        case 'spikesDodged':
        case 'roadblockPassed':
          this.tone(1175, 0.1, 'triangle', 0.07)
          this.tone(1568, 0.14, 'triangle', 0.06, 0.08)
          break
        default:
          break
      }
    }
  }

  private tone(freq: number, duration: number, type: OscillatorType, level: number, delay = 0): void {
    const t = this.ctx.currentTime + 0.005 + delay
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    o.connect(g).connect(this.engine.sfx)
    o.start(t)
    o.stop(t + duration + 0.02)
  }

  private click(freq: number): void {
    const t = this.ctx.currentTime + 0.003
    const o = this.ctx.createOscillator()
    o.type = 'square'
    o.frequency.value = freq
    const g = this.gain(0)
    g.gain.setValueAtTime(0.04, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
    o.connect(g).connect(this.engine.sfx)
    o.start(t)
    o.stop(t + 0.05)
  }

  private noiseBurst(duration: number, f0: number, f1: number, level: number, type: BiquadFilterType = 'bandpass'): void {
    const t = this.ctx.currentTime + 0.005
    const src = this.ctx.createBufferSource()
    src.buffer = this.engine.noise
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(f0, t)
    f.frequency.exponentialRampToValueAtTime(f1, t + duration)
    const g = this.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    src.connect(f).connect(g).connect(this.engine.sfx)
    src.start(t, Math.random())
    src.stop(t + duration + 0.05)
  }

  private whoosh(level: number): void {
    this.noiseBurst(0.45, 3000, 500, level * 0.5)
  }

  private crash(level: number): void {
    this.noiseBurst(0.5, 2500, 300, level * 0.6, 'lowpass')
    this.noiseBurst(0.25, 5000, 2000, level * 0.25, 'highpass')
    const t = this.ctx.currentTime + 0.005
    const o = this.ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(110, t)
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3)
    const g = this.gain(0)
    g.gain.setValueAtTime(level * 0.5, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    o.connect(g).connect(this.engine.sfx)
    o.start(t)
    o.stop(t + 0.4)
  }
}

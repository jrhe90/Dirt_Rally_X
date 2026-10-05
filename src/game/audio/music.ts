import { saturationCurve, type AudioEngine } from './engine'

const BPM = 128
const STEP = 60 / BPM / 4
const STEPS_PER_BAR = 16
const BARS_PER_SECTION = 8
const LOOKAHEAD = 0.18
const TICK_MS = 25

type Chord = { bass: number; guitar: number; triad: [number, number, number] }

const CHORDS: Record<string, Chord> = {
  Em: { bass: 40, guitar: 40, triad: [52, 55, 59] },
  C: { bass: 36, guitar: 48, triad: [52, 55, 60] },
  G: { bass: 43, guitar: 43, triad: [50, 55, 59] },
  D: { bass: 38, guitar: 50, triad: [50, 54, 57] },
  B: { bass: 35, guitar: 47, triad: [51, 54, 59] },
  Am: { bass: 45, guitar: 45, triad: [52, 57, 60] },
}

type SectionName = 'intro' | 'verse' | 'chorus' | 'break'

const SECTIONS: Record<SectionName, string[]> = {
  intro: ['Em', 'Em', 'C', 'C', 'G', 'G', 'D', 'D'],
  verse: ['Em', 'Em', 'C', 'C', 'G', 'G', 'D', 'D'],
  chorus: ['C', 'D', 'Em', 'Em', 'C', 'D', 'B', 'B'],
  break: ['Am', 'Am', 'C', 'C', 'Em', 'Em', 'D', 'B'],
}

/** First pass plays the intro, then the arrangement loops from the first verse. */
const ARRANGEMENT: SectionName[] = ['intro', 'verse', 'chorus', 'verse', 'break', 'chorus', 'verse', 'chorus']

/** Chorus melody as [bar, step, midi, length in steps]. */
const MELODY: [number, number, number, number][] = [
  [0, 0, 67, 4], [0, 4, 67, 2], [0, 6, 69, 2], [0, 8, 71, 8],
  [1, 0, 69, 4], [1, 4, 66, 4], [1, 8, 62, 8],
  [2, 0, 64, 6], [2, 6, 67, 2], [2, 8, 71, 4], [2, 12, 74, 4],
  [3, 0, 71, 16],
  [4, 0, 72, 4], [4, 4, 71, 4], [4, 8, 67, 4], [4, 12, 64, 4],
  [5, 0, 66, 4], [5, 4, 69, 4], [5, 8, 74, 8],
  [6, 0, 75, 8], [6, 8, 71, 8],
  [7, 0, 71, 12], [7, 12, 66, 4],
]

const ARP_PATTERN = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 5, 4, 2, 1, 2]

type LayerName = 'pad' | 'arp' | 'hats' | 'drums' | 'bass' | 'guitar' | 'lead'

/** Intensity at which each layer fades in. */
const LAYER_THRESHOLDS: Record<LayerName, number> = {
  pad: 0,
  arp: 0.12,
  hats: 0.3,
  drums: 0.42,
  bass: 0.42,
  guitar: 0.62,
  lead: 0.8,
}

const LAYER_LEVELS: Record<LayerName, number> = {
  pad: 0.16,
  arp: 0.11,
  hats: 0.3,
  drums: 0.75,
  bass: 0.42,
  guitar: 0.2,
  lead: 0.12,
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/**
 * Procedural rally rock in E minor: synthesized drums, bass, double-tracked distorted guitars,
 * pad, arpeggio and a chorus lead, scheduled ahead on the audio clock. Intensity (0–1) brings
 * layers in and opens the master filter, so the start screen is calm and flat-out driving is loud.
 */
export class Music {
  private readonly engine: AudioEngine
  private readonly ctx: AudioContext
  private readonly layers = {} as Record<LayerName, GainNode>
  private readonly layerOn = {} as Record<LayerName, boolean>
  private cutoff = 20000
  private readonly sidechain: GainNode
  private readonly tone: BiquadFilterNode
  private readonly reverb: GainNode
  private readonly delay: GainNode
  private readonly guitarMuted: AudioNode
  private readonly guitarOpen: AudioNode
  private intensity = 0.3
  private target = 0.3
  private step = 0
  private nextTime = 0
  private timer: number | undefined

  constructor(engine: AudioEngine) {
    this.engine = engine
    const ctx = engine.ctx
    this.ctx = ctx

    this.tone = ctx.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.Q.value = 0.6
    this.tone.connect(engine.music)

    // Everything except the drums pumps against the kick.
    this.sidechain = ctx.createGain()
    this.sidechain.connect(this.tone)

    for (const name of Object.keys(LAYER_LEVELS) as LayerName[]) {
      const g = ctx.createGain()
      g.gain.value = 0
      g.connect(name === 'drums' || name === 'hats' ? this.tone : this.sidechain)
      this.layers[name] = g
    }

    this.reverb = this.buildReverb()
    this.delay = this.buildDelay()
    this.guitarMuted = this.buildGuitarChain(1500, -0.75)
    this.guitarOpen = this.buildGuitarChain(4200, 0.75)
    this.applyIntensity(true)
  }

  private buildReverb(): GainNode {
    const { ctx } = this
    const seconds = 2.4
    const length = Math.floor(ctx.sampleRate * seconds)
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c)
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2
    }
    const convolver = ctx.createConvolver()
    convolver.buffer = impulse
    const send = ctx.createGain()
    const ret = ctx.createGain()
    ret.gain.value = 0.32
    send.connect(convolver).connect(ret).connect(this.tone)
    return send
  }

  private buildDelay(): GainNode {
    const { ctx } = this
    const send = ctx.createGain()
    const delay = ctx.createDelay(2)
    delay.delayTime.value = STEP * 3
    const feedback = ctx.createGain()
    feedback.gain.value = 0.38
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 2600
    const ret = ctx.createGain()
    ret.gain.value = 0.45
    const pan = ctx.createStereoPanner()
    pan.pan.value = 0.35
    send.connect(delay).connect(damp).connect(feedback).connect(delay)
    damp.connect(pan).connect(ret).connect(this.sidechain)
    return send
  }

  /** Fuzz into a cab-ish filter, split into a hard-panned double with a short Haas delay. */
  private buildGuitarChain(cabCutoff: number, pan: number): AudioNode {
    const { ctx } = this
    const input = ctx.createBiquadFilter()
    input.type = 'highpass'
    input.frequency.value = 90
    const fuzz = ctx.createWaveShaper()
    fuzz.curve = saturationCurve(9)
    fuzz.oversample = '4x'
    const scoop = ctx.createBiquadFilter()
    scoop.type = 'peaking'
    scoop.frequency.value = 750
    scoop.Q.value = 0.9
    scoop.gain.value = -5
    const cab = ctx.createBiquadFilter()
    cab.type = 'lowpass'
    cab.frequency.value = cabCutoff
    cab.Q.value = 0.8
    const left = ctx.createStereoPanner()
    left.pan.value = pan
    const right = ctx.createStereoPanner()
    right.pan.value = -pan
    const haas = ctx.createDelay(0.05)
    haas.delayTime.value = 0.013
    input.connect(fuzz).connect(scoop).connect(cab)
    cab.connect(left).connect(this.layers.guitar)
    cab.connect(haas).connect(right).connect(this.layers.guitar)
    return input
  }

  setIntensity(value: number): void {
    this.target = Math.min(1, Math.max(0, value))
  }

  start(): void {
    if (this.timer !== undefined) return
    this.nextTime = this.ctx.currentTime + 0.1
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    window.clearInterval(this.timer)
    this.timer = undefined
  }

  private applyIntensity(immediate = false): void {
    const now = this.ctx.currentTime
    for (const name of Object.keys(this.layers) as LayerName[]) {
      const on = this.intensity >= LAYER_THRESHOLDS[name]
      if (!immediate && on === this.layerOn[name]) continue
      this.layerOn[name] = on
      const level = on ? LAYER_LEVELS[name] : 0
      if (immediate) this.layers[name].gain.value = level
      else this.layers[name].gain.setTargetAtTime(level, now, on ? 0.6 : 1.2)
    }
    const cutoff = Math.min(2200 * 9 ** this.intensity, 20000)
    if (immediate || Math.abs(cutoff - this.cutoff) / this.cutoff > 0.03) {
      this.cutoff = cutoff
      this.tone.frequency.setTargetAtTime(cutoff, now, immediate ? 0.01 : 0.5)
    }
  }

  private layerAudible(name: LayerName): boolean {
    return this.intensity >= LAYER_THRESHOLDS[name] || this.layers[name].gain.value > 0.005
  }

  private tick(): void {
    if (this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    // After a stall (background tab, breakpoint) skip ahead instead of firing a burst of notes.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05

    const before = this.intensity
    this.intensity += (this.target - this.intensity) * 0.04
    if (Math.abs(this.intensity - before) > 1e-4) this.applyIntensity()

    while (this.nextTime < now + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextTime)
      this.step++
      this.nextTime += STEP
    }
  }

  private position(step: number) {
    const bar = Math.floor(step / STEPS_PER_BAR)
    const sectionIndex = Math.floor(bar / BARS_PER_SECTION)
    const index = sectionIndex < ARRANGEMENT.length ? sectionIndex : 1 + ((sectionIndex - 1) % (ARRANGEMENT.length - 1))
    const section = ARRANGEMENT[index]
    const barInSection = bar % BARS_PER_SECTION
    return {
      section,
      bar: barInSection,
      step: step % STEPS_PER_BAR,
      chord: CHORDS[SECTIONS[section][barInSection]],
      firstOfSection: barInSection === 0 && step % STEPS_PER_BAR === 0,
    }
  }

  private scheduleStep(globalStep: number, t: number): void {
    const { section, bar, step, chord, firstOfSection } = this.position(globalStep)
    const lastBar = bar === BARS_PER_SECTION - 1
    const full = section === 'verse' || section === 'chorus'

    if (this.layerAudible('pad') && step === 0) {
      this.pad(t, chord.triad, STEP * STEPS_PER_BAR, section === 'chorus' ? 1 : 0.8)
    }

    if (this.layerAudible('arp')) {
      const tones = [...chord.triad, chord.triad[0] + 12, chord.triad[1] + 12, chord.triad[2] + 12]
      const note = tones[ARP_PATTERN[step]] + 12
      const vel = step % 4 === 0 ? 1 : 0.65
      if (section !== 'chorus' || step % 2 === 0) this.arp(t, note, vel)
    }

    if (this.layerAudible('hats')) {
      if (section === 'chorus' && step % 4 === 2) this.hat(t, true, 0.8)
      else if (step % 2 === 0) this.hat(t, false, step % 4 === 0 ? 0.9 : 0.6)
      else if (full || (section === 'break' && bar >= 4)) this.hat(t, false, 0.3)
    }

    if (this.layerAudible('drums')) {
      if (firstOfSection && full) this.crash(t)
      if (full) {
        const kicks = section === 'chorus' ? [0, 3, 8, 10] : [0, 7, 8, 11]
        const fill = lastBar && step >= 12
        if (kicks.includes(step) && !fill) this.kick(t)
        if (step === 4 || step === 12) this.snare(t, 1)
        if (fill) this.snare(t, 0.55 + (step - 12) * 0.15)
      } else if (section === 'break') {
        if (step === 0) this.kick(t, 0.8)
        if (lastBar && step >= 8) this.snare(t, 0.3 + (step - 8) * 0.09)
        if (lastBar && step === 0) this.riser(t, STEP * STEPS_PER_BAR)
      } else if (section === 'intro' && lastBar && step >= 8 && step % 2 === 0) {
        this.snare(t, 0.4 + (step - 8) * 0.08)
      }
    }

    if (this.layerAudible('bass')) {
      if (full) {
        if (step % 2 === 0) {
          const octave = step === 6 || step === 14 ? 12 : 0
          this.bass(t, chord.bass + octave, STEP * 1.7)
        }
      } else if (step === 0) {
        this.bass(t, chord.bass, STEP * 15)
      }
    }

    if (this.layerAudible('guitar')) {
      if (section === 'verse') {
        if ([0, 2, 3, 4, 6, 8, 10, 11, 12, 14].includes(step)) this.guitar(t, chord.guitar, STEP * 0.9, true)
      } else if (section === 'chorus') {
        if (step === 0) this.guitar(t, chord.guitar, STEP * 6, false)
        if (step === 6) this.guitar(t, chord.guitar, STEP * 2, false)
        if (step === 8) this.guitar(t, chord.guitar, STEP * 8, false)
      }
    }

    if (this.layerAudible('lead') && section === 'chorus') {
      for (const [b, s, midi, len] of MELODY) if (b === bar && s === step) this.lead(t, midi, STEP * len)
    }
  }

  private envelope(t: number, attack: number, hold: number, release: number, peak: number): GainNode {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.setValueAtTime(peak, t + attack + hold)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release)
    return g
  }

  private noiseSource(t: number, duration: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = this.engine.noise
    src.start(t, Math.random() * 1.5)
    src.stop(t + duration)
    return src
  }

  private kick(t: number, vel = 1): void {
    const { ctx } = this
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.12)
    const g = this.envelope(t, 0.002, 0.02, 0.34, vel)
    osc.connect(g).connect(this.layers.drums)
    osc.start(t)
    osc.stop(t + 0.4)

    const click = ctx.createBiquadFilter()
    click.type = 'highpass'
    click.frequency.value = 2500
    const cg = this.envelope(t, 0.001, 0.002, 0.012, 0.25 * vel)
    this.noiseSource(t, 0.03).connect(click).connect(cg).connect(this.layers.drums)

    const sc = this.sidechain.gain
    sc.cancelScheduledValues(t)
    sc.setValueAtTime(0.5, t)
    sc.setTargetAtTime(1, t + 0.02, 0.07)
  }

  private snare(t: number, vel: number): void {
    const { ctx } = this
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1900
    band.Q.value = 0.7
    const ng = this.envelope(t, 0.001, 0.01, 0.17, 0.75 * vel)
    this.noiseSource(t, 0.25).connect(band).connect(ng)
    ng.connect(this.layers.drums)
    ng.connect(this.reverb)

    const body = ctx.createOscillator()
    body.type = 'triangle'
    body.frequency.setValueAtTime(200, t)
    body.frequency.exponentialRampToValueAtTime(150, t + 0.08)
    const bg = this.envelope(t, 0.001, 0.01, 0.09, 0.5 * vel)
    body.connect(bg).connect(this.layers.drums)
    body.start(t)
    body.stop(t + 0.15)
  }

  private hat(t: number, open: boolean, vel: number): void {
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7200
    const g = this.envelope(t, 0.001, 0.004, open ? 0.2 : 0.035, 0.4 * vel)
    this.noiseSource(t, open ? 0.3 : 0.08).connect(hp).connect(g).connect(this.layers.hats)
  }

  private crash(t: number): void {
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 4200
    const g = this.envelope(t, 0.002, 0.03, 1.7, 0.32)
    this.noiseSource(t, 1.9).connect(hp).connect(g)
    g.connect(this.layers.hats)
    g.connect(this.reverb)
  }

  private riser(t: number, duration: number): void {
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 2.5
    bp.frequency.setValueAtTime(400, t)
    bp.frequency.exponentialRampToValueAtTime(7000, t + duration)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.22, t + duration)
    g.gain.linearRampToValueAtTime(0, t + duration + 0.02)
    this.noiseSource(t, duration + 0.05).connect(bp).connect(g)
    g.connect(this.layers.hats)
    g.connect(this.reverb)
  }

  private bass(t: number, midi: number, duration: number): void {
    const { ctx } = this
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = 3
    filter.frequency.setValueAtTime(1300, t)
    filter.frequency.exponentialRampToValueAtTime(320, t + Math.min(duration, 0.25))
    const g = this.envelope(t, 0.004, Math.max(0, duration - 0.06), 0.06, 1)
    filter.connect(g).connect(this.layers.bass)
    for (const [type, detune, octave, level] of [
      ['sawtooth', -7, 0, 0.5],
      ['sawtooth', 7, 0, 0.5],
      ['sine', 0, -12, 0.45],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = hz(midi + octave)
      osc.detune.value = detune
      const lg = ctx.createGain()
      lg.gain.value = level
      osc.connect(lg).connect(filter)
      osc.start(t)
      osc.stop(t + duration + 0.1)
    }
  }

  /** Power chord (root, fifth, octave) into the shared fuzz chain. */
  private guitar(t: number, root: number, duration: number, muted: boolean): void {
    const { ctx } = this
    const g = this.envelope(t, 0.003, muted ? 0.02 : duration * 0.6, muted ? 0.09 : duration * 0.5, 0.5)
    g.connect(muted ? this.guitarMuted : this.guitarOpen)
    for (const interval of [0, 7, 12]) {
      for (const detune of [-9, 9]) {
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = hz(root + interval)
        osc.detune.value = detune + (Math.random() - 0.5) * 4
        osc.connect(g)
        osc.start(t)
        osc.stop(t + duration + 0.2)
      }
    }
  }

  private pad(t: number, triad: readonly number[], duration: number, brightness: number): void {
    const { ctx } = this
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900 + 900 * brightness
    filter.Q.value = 0.7
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5, t + 0.45)
    g.gain.setValueAtTime(0.5, t + duration - 0.1)
    g.gain.linearRampToValueAtTime(0, t + duration + 0.7)
    filter.connect(g)
    g.connect(this.layers.pad)
    g.connect(this.reverb)
    for (const midi of triad) {
      for (const detune of [-11, 11]) {
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = hz(midi)
        osc.detune.value = detune
        osc.connect(filter)
        osc.start(t)
        osc.stop(t + duration + 0.8)
      }
    }
  }

  private arp(t: number, midi: number, vel: number): void {
    const { ctx } = this
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = hz(midi)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1400 + 3200 * this.intensity
    filter.Q.value = 2
    const g = this.envelope(t, 0.002, 0.01, 0.14, 0.45 * vel)
    osc.connect(filter).connect(g)
    g.connect(this.layers.arp)
    g.connect(this.delay)
    osc.start(t)
    osc.stop(t + 0.2)
  }

  private lead(t: number, midi: number, duration: number): void {
    const { ctx } = this
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 3200
    filter.Q.value = 1.2
    const g = this.envelope(t, 0.02, Math.max(0, duration - 0.1), 0.18, 0.5)
    filter.connect(g)
    g.connect(this.layers.lead)
    g.connect(this.delay)
    g.connect(this.reverb)

    const vibrato = ctx.createOscillator()
    vibrato.frequency.value = 5.6
    const depth = ctx.createGain()
    depth.gain.setValueAtTime(0, t)
    depth.gain.linearRampToValueAtTime(9, t + Math.min(0.35, duration))
    vibrato.connect(depth)
    vibrato.start(t)
    vibrato.stop(t + duration + 0.3)

    for (const [type, detune] of [
      ['sawtooth', -5],
      ['square', 5],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = hz(midi)
      osc.detune.value = detune
      depth.connect(osc.detune)
      osc.connect(filter)
      osc.start(t)
      osc.stop(t + duration + 0.3)
    }
  }
}

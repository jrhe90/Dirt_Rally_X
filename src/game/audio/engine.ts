const MUSIC_LEVEL = 0.55
const DUCKED_LEVEL = 0.38

/** Soft-clipping curve; `drive` sets how hard it saturates. */
export function saturationCurve(drive: number, size = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size)
  const norm = Math.tanh(drive)
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1
    curve[i] = Math.tanh(x * drive) / norm
  }
  return curve
}

/**
 * One AudioContext with three buses: music (ducked under the co-driver), voice (helmet intercom
 * colouring) and sfx, all through a gentle master compressor.
 */
export class AudioEngine {
  readonly ctx: AudioContext
  readonly music: GainNode
  readonly voice: GainNode
  readonly sfx: GainNode
  /** Two seconds of white noise shared by drums, risers and intercom hiss. */
  readonly noise: AudioBuffer
  private readonly master: GainNode
  private readonly musicLevel: GainNode
  private musicOn = true
  private ducked = false
  private muted = false

  constructor() {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx

    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -12
    compressor.knee.value = 8
    compressor.ratio.value = 4
    compressor.attack.value = 0.004
    compressor.release.value = 0.25
    compressor.connect(ctx.destination)

    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(compressor)

    this.musicLevel = ctx.createGain()
    this.musicLevel.gain.value = MUSIC_LEVEL
    this.musicLevel.connect(this.master)
    this.music = ctx.createGain()
    this.music.connect(this.musicLevel)

    this.voice = ctx.createGain()
    this.voice.connect(this.buildIntercom())

    this.sfx = ctx.createGain()
    this.sfx.gain.value = 0.5
    this.sfx.connect(this.master)

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }

  /** Band-limited, lightly driven chain that sounds like a rally helmet intercom. */
  private buildIntercom(): AudioNode {
    const { ctx } = this
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 300
    highpass.Q.value = 0.8
    const presence = ctx.createBiquadFilter()
    presence.type = 'peaking'
    presence.frequency.value = 2300
    presence.Q.value = 1.1
    presence.gain.value = 6
    const drive = ctx.createWaveShaper()
    drive.curve = saturationCurve(2.2)
    drive.oversample = '2x'
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 3600
    lowpass.Q.value = 0.9
    const out = ctx.createGain()
    out.gain.value = 1.15
    highpass.connect(presence).connect(drive).connect(lowpass).connect(out).connect(this.master)
    return highpass
  }

  get running(): boolean {
    return this.ctx.state === 'running'
  }

  /** Must be called from a user gesture on iOS / Chrome autoplay rules. */
  unlock(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  /** Resume on the first gesture anywhere, for paths that skip the start screen. */
  unlockOnFirstGesture(): void {
    const handler = () => {
      this.unlock()
      if (this.running) {
        window.removeEventListener('pointerdown', handler)
        window.removeEventListener('keydown', handler)
      }
    }
    window.addEventListener('pointerdown', handler)
    window.addEventListener('keydown', handler)
  }

  /** Suspend while the tab is hidden so the music does not keep playing in the background. */
  pauseWhenHidden(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.ctx.suspend()
      else void this.ctx.resume()
    })
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on
    this.applyMusicLevel()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05)
  }

  get isMuted(): boolean {
    return this.muted
  }

  /** Pull the music down while the co-driver talks. */
  duck(on: boolean): void {
    if (on === this.ducked) return
    this.ducked = on
    this.applyMusicLevel()
  }

  private applyMusicLevel(): void {
    const target = this.musicOn ? (this.ducked ? DUCKED_LEVEL : MUSIC_LEVEL) : 0
    this.musicLevel.gain.setTargetAtTime(target, this.ctx.currentTime, this.ducked ? 0.06 : 0.35)
  }

  /** Countdown tone. */
  beep(frequency: number, duration: number, level = 0.35): void {
    const { ctx } = this
    const t = ctx.currentTime + 0.01
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = frequency
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = frequency * 3
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(level, t + 0.005)
    gain.gain.setValueAtTime(level, t + duration - 0.03)
    gain.gain.linearRampToValueAtTime(0, t + duration)
    osc.connect(filter).connect(gain).connect(this.sfx)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }
}

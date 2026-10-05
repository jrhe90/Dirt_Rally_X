import type { Track } from '../track'
import { CoDriver, type SpokenCall } from './codriver'
import type { CodriverLanguage } from './codriverClips'
import { AudioEngine } from './engine'
import { Music } from './music'
import { nextCodriver, saveAudioSettings, type AudioSettings, type CodriverSetting } from './settings'

export type RacePhase = 'waiting' | 'countdown' | 'racing' | 'finished'

const CODRIVER_LABELS: Record<CodriverSetting, string> = { zh: '中文', en: 'ENGLISH', off: 'OFF' }

/** Music, co-driver and countdown tones, driven by the race phase and the car's speed. */
export class GameAudio {
  readonly engine = new AudioEngine()
  readonly music: Music
  readonly codriver: CoDriver
  private settings: AudioSettings

  constructor(track: Track, laps: number, settings: AudioSettings, onSpeak: (calls: SpokenCall[], lang: CodriverLanguage) => void) {
    this.music = new Music(this.engine)
    this.codriver = new CoDriver(this.engine, track, laps, onSpeak)
    this.settings = settings
    this.apply()
    this.engine.pauseWhenHidden()
  }

  get current(): AudioSettings {
    return { ...this.settings }
  }

  update(settings: AudioSettings): void {
    this.settings = settings
    saveAudioSettings(settings)
    this.apply()
  }

  private apply(): void {
    this.engine.setMusicEnabled(this.settings.music)
    this.codriver.setEnabled(this.settings.codriver !== 'off')
    if (this.settings.codriver !== 'off' && this.settings.codriver !== this.codriver.language) {
      void this.codriver.setLanguage(this.settings.codriver)
    }
  }

  /** Preload the selected voice while the stage is still building. */
  preload(): Promise<void> {
    return this.settings.codriver === 'off' ? Promise.resolve() : this.codriver.setLanguage(this.settings.codriver)
  }

  /** Call from a user gesture. */
  start(): void {
    this.engine.unlock()
    this.music.start()
  }

  toggleMusic(): string {
    this.update({ ...this.settings, music: !this.settings.music })
    return `MUSIC ${this.settings.music ? 'ON' : 'OFF'}`
  }

  cycleCodriver(): string {
    this.update({ ...this.settings, codriver: nextCodriver(this.settings.codriver) })
    return `CO-DRIVER ${CODRIVER_LABELS[this.settings.codriver]}`
  }

  toggleMute(): boolean {
    this.engine.setMuted(!this.engine.isMuted)
    return this.engine.isMuted
  }

  countdown(n: number): void {
    if (n > 0) this.engine.beep(660, 0.14)
    else this.engine.beep(1320, 0.42)
  }

  restart(progress: number): void {
    this.codriver.resync(progress)
    this.codriver.say(['ready'])
  }

  recovered(progress: number): void {
    this.codriver.resync(progress)
    this.codriver.say(['back'])
  }

  finished(): void {
    this.codriver.say(['stageClear'])
  }

  frame(phase: RacePhase, progress: number, speed: number): void {
    const intensity =
      phase === 'racing' ? 0.55 + 0.45 * Math.min(speed / 28, 1) : phase === 'countdown' ? 0.5 : phase === 'finished' ? 0.32 : 0.3
    this.music.setIntensity(intensity)
    if (phase === 'countdown' || phase === 'racing') this.codriver.update(progress, speed)
  }
}

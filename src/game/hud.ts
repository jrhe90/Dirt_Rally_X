import type { Surface } from './track'
import { CAR } from './vehicle/config'
import { LAPS } from './race'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

export type HudState = {
  speedKmh: number
  gear: number
  rpm: number
  time: number
  lap: number
  lapProgress: number
  surface: Surface | null
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

export class Hud {
  private readonly speed = $('#speed')
  private readonly gear = $('#gear')
  private readonly rev = $('#rev-fill')
  private readonly time = $('#time')
  private readonly lap = $('#lap')
  private readonly progress = $('#progress-fill')
  private readonly surface = $('#surface')
  private readonly message = $('#message')
  private readonly sub = $('#message-sub')
  private messageTimer: number | undefined

  update(s: HudState): void {
    this.speed.textContent = String(Math.round(s.speedKmh))
    this.gear.textContent = s.gear < 0 ? 'R' : String(s.gear)
    const rev = Math.min(1, (s.rpm - CAR.idleRpm) / (CAR.redline - CAR.idleRpm))
    this.rev.style.transform = `scaleX(${rev.toFixed(3)})`
    this.rev.classList.toggle('redline', s.rpm > CAR.upshiftRpm)
    this.time.textContent = formatTime(s.time)
    this.lap.textContent = `${s.lap} / ${LAPS}`
    this.progress.style.transform = `scaleX(${s.lapProgress.toFixed(3)})`
    this.surface.textContent = s.surface ? s.surface.toUpperCase() : 'AIRBORNE'
    this.surface.dataset.surface = s.surface ?? 'air'
  }

  show(text: string, sub = '', hideAfterMs?: number): void {
    window.clearTimeout(this.messageTimer)
    this.message.textContent = text
    this.sub.textContent = sub
    this.message.parentElement!.classList.remove('hidden')
    if (hideAfterMs !== undefined) this.messageTimer = window.setTimeout(() => this.hide(), hideAfterMs)
  }

  hide(): void {
    this.message.parentElement!.classList.add('hidden')
  }
}

import type { Surface } from './track'
import { CAR } from './vehicle/config'
import { LAPS } from './race'

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!
const SVG_NS = 'http://www.w3.org/2000/svg'

const TACHO = { cx: 110, cy: 110, r: 92, start: 135, sweep: 255, maxRpm: 8000 }

export type HudState = {
  speedKmh: number
  gear: number
  rpm: number
  time: number
  lap: number
  stageProgress: number
  lapTimes: readonly number[]
  currentLapTime: number
  surface: Surface | null
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

function polar(deg: number, radius: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [TACHO.cx + Math.cos(a) * radius, TACHO.cy + Math.sin(a) * radius]
}

function rpmAngle(rpm: number): number {
  return TACHO.start + (Math.min(rpm, TACHO.maxRpm) / TACHO.maxRpm) * TACHO.sweep
}

function arcPath(fromDeg: number, toDeg: number, radius: number): string {
  const [x0, y0] = polar(fromDeg, radius)
  const [x1, y1] = polar(toDeg, radius)
  const large = toDeg - fromDeg > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export class Hud {
  private readonly speed = $<HTMLElement>('#speed')
  private readonly gear = $<HTMLElement>('#gear')
  private readonly gearBox = $<HTMLElement>('.tacho-gear')
  private readonly needle = $<SVGGElement>('#tacho-needle')
  private readonly arc = $<SVGPathElement>('#tacho-arc')
  private readonly time = $<HTMLElement>('#time')
  private readonly lap = $<HTMLElement>('#lap')
  private readonly progress = $<HTMLElement>('#progress-fill')
  private readonly progressCar = $<HTMLElement>('#progress-car')
  private readonly surface = $<HTMLElement>('#surface')
  private readonly board = $<HTMLOListElement>('#board')
  private readonly message = $<HTMLElement>('#message')
  private readonly sub = $<HTMLElement>('#message-sub')
  private readonly rows: { time: HTMLElement; row: HTMLElement }[] = []
  private readonly toastEl = $<HTMLElement>('#toast')
  private messageTimer: number | undefined
  private toastTimer: number | undefined
  private lastBoardKey = ''

  constructor() {
    this.buildTacho()
    this.buildBoard()
  }

  private buildTacho(): void {
    const ticks = $<SVGGElement>('#tacho-ticks')
    const redline = rpmAngle(CAR.redline)
    const red = document.createElementNS(SVG_NS, 'path')
    red.setAttribute('d', arcPath(redline, TACHO.start + TACHO.sweep, TACHO.r - 4))
    red.setAttribute('class', 'tacho-red')
    ticks.appendChild(red)

    for (let rpm = 0; rpm <= TACHO.maxRpm; rpm += 250) {
      const major = rpm % 1000 === 0
      const deg = rpmAngle(rpm)
      const [x0, y0] = polar(deg, TACHO.r)
      const [x1, y1] = polar(deg, TACHO.r - (major ? 14 : 7))
      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', x0.toFixed(2))
      line.setAttribute('y1', y0.toFixed(2))
      line.setAttribute('x2', x1.toFixed(2))
      line.setAttribute('y2', y1.toFixed(2))
      line.setAttribute('class', `${major ? 'tick major' : 'tick'}${rpm >= CAR.redline ? ' hot' : ''}`)
      ticks.appendChild(line)
      if (major) {
        const [tx, ty] = polar(deg, TACHO.r - 28)
        const label = document.createElementNS(SVG_NS, 'text')
        label.setAttribute('x', tx.toFixed(2))
        label.setAttribute('y', ty.toFixed(2))
        label.setAttribute('class', `tick-label${rpm >= CAR.redline - 600 ? ' hot' : ''}`)
        label.textContent = String(rpm / 1000)
        ticks.appendChild(label)
      }
    }
  }

  private buildBoard(): void {
    for (let i = 0; i < LAPS; i++) {
      const row = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = `LAP ${i + 1}`
      const time = document.createElement('span')
      time.className = 'hud-board-time'
      time.textContent = '-:--.--'
      row.append(label, time)
      this.board.appendChild(row)
      this.rows.push({ row, time })
    }
    const best = document.createElement('li')
    best.className = 'best'
    const label = document.createElement('span')
    label.textContent = 'BEST'
    const time = document.createElement('span')
    time.className = 'hud-board-time'
    time.textContent = '-:--.--'
    best.append(label, time)
    this.board.appendChild(best)
    this.rows.push({ row: best, time })
  }

  update(s: HudState): void {
    this.speed.textContent = String(Math.round(s.speedKmh))
    this.gear.textContent = s.gear < 0 ? 'R' : s.gear === 0 ? 'N' : String(s.gear)
    this.gearBox.classList.toggle('shift', s.rpm > CAR.upshiftRpm)

    const deg = rpmAngle(s.rpm)
    this.needle.style.transform = `rotate(${(deg - 270).toFixed(1)}deg)`
    this.arc.setAttribute('d', arcPath(TACHO.start, Math.max(TACHO.start + 0.5, deg), TACHO.r - 4))

    this.time.textContent = formatTime(s.time)
    this.lap.textContent = `LAP ${s.lap} / ${LAPS}`
    this.progress.style.transform = `scaleY(${s.stageProgress.toFixed(4)})`
    this.progressCar.style.bottom = `${(s.stageProgress * 100).toFixed(2)}%`
    this.surface.textContent = s.surface ? s.surface.toUpperCase() : 'AIRBORNE'
    this.surface.dataset.surface = s.surface ?? 'air'

    const current = s.lapTimes.length
    const key = `${current}`
    for (let i = 0; i < LAPS; i++) {
      const { row, time } = this.rows[i]
      if (i < current) time.textContent = formatTime(s.lapTimes[i])
      else if (i === current) time.textContent = formatTime(s.currentLapTime)
      else time.textContent = '-:--.--'
      if (key !== this.lastBoardKey) row.classList.toggle('active', i === current)
    }
    if (key !== this.lastBoardKey) {
      const best = s.lapTimes.length ? Math.min(...s.lapTimes) : null
      this.rows[LAPS].time.textContent = best === null ? '-:--.--' : formatTime(best)
      this.lastBoardKey = key
    }
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

  /** Small transient notice, e.g. for audio toggles. */
  toast(text: string): void {
    window.clearTimeout(this.toastTimer)
    this.toastEl.textContent = text
    this.toastEl.classList.add('visible')
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), 1400)
  }
}

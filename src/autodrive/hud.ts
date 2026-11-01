import { kmh, SPEED_LIMIT } from './sim/config'
import type { Autopilot } from './sim/fsd/autopilot'
import { heatLevel, isChasing } from './sim/police'
import { POLICE } from './sim/config'
import type { SimEvent, SimState } from './sim/types'

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!

const ARC_LENGTH = Math.PI * 92
const TOP_KMH = 260

type Banner = { main: string; sub: string; kind: string; until: number }

/** The heads-up display: bounty, heat, pursuit meters, speed, damage, and the autopilot panel. */
export class Hud {
  private readonly bounty = $('#bounty')
  private readonly heat = $('#heat')
  private readonly heatBars = [...document.querySelectorAll<HTMLElement>('#heat i')]
  private readonly pursuitLine = $('#pursuit-line')
  private readonly meter = $('#meter')
  private readonly meterFill = $('#meter-fill')
  private readonly meterLabel = $('#meter-label')
  private readonly feed = $('#feed')
  private readonly banner = $('#banner')
  private readonly bannerMain = $('#banner-main')
  private readonly bannerSub = $('#banner-sub')
  private readonly speed = $('#speed')
  private readonly arcFill = $('#arc-fill') as unknown as SVGPathElement
  private readonly arcSet = $('#arc-set') as unknown as SVGPathElement
  private readonly damage = $('#damage')
  private readonly panel = $('#ap-panel')
  private readonly apState = $('#ap-state')
  private readonly apProfile = $('#ap-profile')
  private readonly apSet = $('#ap-set')
  private readonly apReason = $('#ap-reason')
  private readonly limit = $('#limit')
  private readonly alertFrame = $('#alert-frame')
  private readonly hints = $('#hints')
  private shownBounty = 0
  private bannerState: Banner | null = null
  private last = { speed: '', set: '', reason: '', state: '', profile: '' }
  private time = 0

  constructor() {
    this.arcFill.style.strokeDasharray = `${ARC_LENGTH}`
    this.arcFill.style.strokeDashoffset = `${ARC_LENGTH}`
    this.limit.textContent = String(Math.round(kmh(SPEED_LIMIT)))
    setTimeout(() => this.hints.classList.add('fade'), 14000)
  }

  reset(): void {
    this.shownBounty = 0
    this.feed.replaceChildren()
    this.banner.hidden = true
    this.bannerState = null
  }

  popup(label: string, amount?: number): void {
    const el = document.createElement('div')
    el.textContent = label
    if (amount !== undefined) {
      const b = document.createElement('b')
      b.textContent = `+${amount.toLocaleString('en-US')}`
      el.append(b)
    }
    this.feed.append(el)
    while (this.feed.children.length > 4) this.feed.firstElementChild?.remove()
    setTimeout(() => el.remove(), 2000)
  }

  showBanner(main: string, sub: string, kind: string, seconds: number): void {
    this.bannerState = { main, sub, kind, until: this.time + seconds }
    this.bannerMain.textContent = main
    this.bannerSub.textContent = sub
    this.banner.className = `banner ${kind}`
    this.banner.hidden = false
    // Restart the slam animation.
    this.bannerMain.style.animation = 'none'
    void this.bannerMain.offsetWidth
    this.bannerMain.style.animation = ''
  }

  handle(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'bounty':
          this.popup(e.label, e.amount)
          break
        case 'pursuit':
          this.showBanner('PURSUIT', 'POLICE ARE CHASING YOU', 'cop', 2.2)
          break
        case 'heat':
          if (e.level > 1) this.popup(`HEAT LEVEL ${e.level}`)
          break
        case 'escaped':
          this.showBanner('ESCAPED', `HEAT ${e.heat} PURSUIT EVADED`, 'blue', 2.6)
          break
        case 'roadblock':
          this.popup('ROADBLOCK AHEAD')
          break
        case 'spikesDropped':
          this.popup('SPIKE STRIP DEPLOYED')
          break
        case 'spiked':
          this.showBanner('SPIKED', 'TYRES DAMAGED', '', 1.8)
          break
        default:
          break
      }
    }
  }

  update(sim: SimState, ap: Autopilot, dt: number): void {
    this.time += dt
    const e = sim.ego
    this.shownBounty += (sim.bounty - this.shownBounty) * Math.min(1, dt * 6)
    this.bounty.textContent = Math.round(this.shownBounty).toLocaleString('en-US')

    // Heat and pursuit state.
    const level = sim.pursuit ? heatLevel(sim) : 0
    this.heatBars.forEach((b, i) => b.classList.toggle('on', i < level))
    this.heat.classList.toggle('flash', sim.pursuit && Math.floor(this.time * 4) % 2 === 0)
    const units = sim.agents.filter((a) => isChasing(a)).length
    let line = ''
    if (sim.mode === 'cruise') line = 'FREE DRIVE · NO POLICE'
    else if (sim.pursuit) line = `PURSUIT · ${units} UNIT${units === 1 ? '' : 'S'}`
    else line = kmh(e.v) > kmh(SPEED_LIMIT) + 14 ? 'SPEEDING · WATCH FOR CAMERAS' : 'CLEAN'
    this.pursuitLine.textContent = line
    this.pursuitLine.classList.toggle('active', sim.pursuit)
    if (sim.pursuit && sim.bust > 0.02) {
      this.meter.hidden = false
      this.meter.className = 'meter bust'
      this.meterFill.style.transform = `scaleX(${sim.bust})`
      this.meterLabel.textContent = 'BUSTING'
    } else if (sim.pursuit && sim.cooldown > 0.05) {
      this.meter.hidden = false
      this.meter.className = 'meter'
      this.meterFill.style.transform = `scaleX(${sim.cooldown / POLICE.escapeTime})`
      this.meterLabel.textContent = 'COOLDOWN'
    } else this.meter.hidden = true

    // Speed.
    const speed = String(Math.round(Math.abs(kmh(e.v))))
    if (speed !== this.last.speed) {
      this.speed.textContent = speed
      this.last.speed = speed
    }
    const f = Math.min(1, Math.abs(kmh(e.v)) / TOP_KMH)
    this.arcFill.style.strokeDashoffset = `${ARC_LENGTH * (1 - f)}`
    const setF = Math.min(1, kmh(ap.setSpeed) / TOP_KMH)
    const a = Math.PI * (1 - setF)
    const x0 = 110 + Math.cos(a) * 84
    const y0 = 120 - Math.sin(a) * 84
    const x1 = 110 + Math.cos(a) * 100
    const y1 = 120 - Math.sin(a) * 100
    this.arcSet.setAttribute('d', ap.engaged ? `M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}` : '')
    this.damage.style.width = `${Math.round(e.damage * 100)}%`

    // Autopilot panel.
    const st = ap.status
    const state = ap.engaged ? (st.takeover ? 'TAKE OVER' : 'AUTOPILOT ENGAGED') : 'AUTOPILOT READY'
    if (state !== this.last.state) {
      this.apState.textContent = state
      this.last.state = state
    }
    this.panel.classList.toggle('engaged', ap.engaged)
    this.panel.classList.toggle('takeover', ap.engaged && st.takeover)
    const profile = `${ap.profile.label} PROFILE`
    if (profile !== this.last.profile) {
      this.apProfile.textContent = profile
      this.last.profile = profile
    }
    const set = String(Math.round(kmh(ap.setSpeed)))
    if (set !== this.last.set) {
      this.apSet.textContent = set
      this.last.set = set
    }
    let reason = ap.engaged ? st.reason : 'Press F to engage · driving manually'
    if (ap.engaged && st.signal !== 0 && !st.laneChange) reason = `Signalling ${st.signal > 0 ? 'left' : 'right'} · waiting for a gap`
    if (sim.ego.tiresBlown && !ap.engaged) reason = 'Tyres damaged'
    if (reason !== this.last.reason) {
      this.apReason.textContent = reason
      this.last.reason = reason
    }
    this.alertFrame.classList.toggle('on', ap.engaged && st.takeover)

    if (ap.engaged && st.takeover) {
      if (!this.bannerState || this.bannerState.kind !== 'alarm') this.showBanner('TAKE OVER IMMEDIATELY', '', 'alarm', 0.4)
      else this.bannerState.until = this.time + 0.4
    }
    if (this.bannerState && this.time > this.bannerState.until) {
      this.banner.hidden = true
      this.bannerState = null
    }
  }
}

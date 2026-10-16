import type { ObstacleKind, SimEvent } from './sim/types'

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!

const CAUSES: Record<ObstacleKind | 'ground', string> = {
  truck: 'Hit a car transporter',
  overpass: 'Hit an overpass',
  gantry: 'Hit a sign gantry',
  crane: 'Flattened by a wrecking ball',
  laser: 'Caught by a speed-trap laser',
  interceptor: 'Taken out by an interceptor',
  drone: 'Hit a police drone',
  wall: 'Hit the ramp wall',
  ground: 'Landed mid-roll',
}

export type Screen = 'title' | 'ready' | 'playing' | 'paused' | 'results'

/** DOM overlay: run stats, score popups, tutorial hints and the title / results / pause screens. */
export class Hud {
  private readonly hud = $('#hud')
  private readonly distance = $('#distance')
  private readonly best = $('#best')
  private readonly cells = $('#cells')
  private readonly style = $('#style-total')
  private readonly popups = $('#popups')
  private readonly hint = $('#hint')
  private readonly holdPrompt = $('#hold-prompt')
  private readonly screens = { title: $('#title'), results: $('#results'), paused: $('#paused') }
  private hintTimer = 0
  private shown = { distance: -1, cells: -1, style: -1 }

  show(screen: Screen): void {
    this.screens.title.hidden = screen !== 'title'
    this.screens.results.hidden = screen !== 'results'
    this.screens.paused.hidden = screen !== 'paused'
    this.hud.hidden = screen === 'title'
    this.holdPrompt.hidden = screen !== 'ready'
    if (screen !== 'playing') this.clearHint()
  }

  setTitleStats(best: number, cells: number): void {
    $('#title-best').textContent = String(best)
    $('#title-cells').textContent = String(cells)
  }

  setBest(best: number): void {
    this.best.textContent = String(best)
  }

  setToggles(sound: boolean, music: boolean): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
      const on = b.dataset.toggle === 'sound' ? sound : music
      b.setAttribute('aria-pressed', String(on))
      b.textContent = `${b.dataset.toggle === 'sound' ? 'SOUND' : 'MUSIC'} ${on ? 'ON' : 'OFF'}`
    }
  }

  update(distance: number, cells: number, style: number): void {
    const d = Math.floor(distance)
    if (d !== this.shown.distance) this.distance.textContent = String((this.shown.distance = d))
    if (cells !== this.shown.cells) this.cells.textContent = String((this.shown.cells = cells))
    if (style !== this.shown.style) {
      this.shown.style = style
      this.style.textContent = style > 0 ? `+${style} STYLE` : ''
    }
  }

  popup(text: string, sub: string, kind: 'near' | 'roll' | 'clean' | 'dodge', x: number, y: number): void {
    const el = document.createElement('div')
    el.className = `popup ${kind}`
    el.textContent = text
    if (sub) {
      const small = document.createElement('small')
      small.textContent = sub
      el.append(small)
    }
    el.style.left = `${Math.min(window.innerWidth - 60, Math.max(60, x))}px`
    el.style.top = `${Math.max(80, y)}px`
    el.addEventListener('animationend', () => el.remove())
    this.popups.append(el)
  }

  /** Popups for scoring events, placed above the car's screen position. */
  handle(events: readonly SimEvent[], carScreen: { x: number; y: number }): void {
    for (const e of events) {
      switch (e.type) {
        case 'nearMiss':
          this.popup(`+${e.points}`, 'NEAR MISS', 'near', carScreen.x, carScreen.y - 20)
          break
        case 'roll':
          this.popup(`+${e.points}`, e.count > 1 ? `BARREL ROLL ×${e.count}` : 'BARREL ROLL', 'roll', carScreen.x, carScreen.y - 30)
          break
        case 'rollDodge':
          this.popup(`+${e.points}`, 'ROLL DODGE', 'dodge', carScreen.x, carScreen.y - 50)
          break
        case 'land':
          if (e.clean) this.popup(`+${e.points}`, e.rolls ? `CLEAN LANDING ×${e.rolls + 1} · BOOST` : 'CLEAN LANDING · BOOST', 'clean', carScreen.x, carScreen.y - 30)
          break
        default:
          break
      }
    }
  }

  showHint(text: string, seconds: number): void {
    this.hint.textContent = text
    this.hint.hidden = false
    window.clearTimeout(this.hintTimer)
    this.hintTimer = window.setTimeout(() => this.clearHint(), seconds * 1000)
  }

  clearHint(): void {
    window.clearTimeout(this.hintTimer)
    this.hint.hidden = true
  }

  showResults(r: { score: number; distance: number; style: number; cells: number; totalCells: number; newBest: boolean; cause: ObstacleKind | 'ground' }): void {
    $('#crash-cause').textContent = CAUSES[r.cause].toUpperCase()
    $('#result-score').textContent = String(r.score)
    $('#result-distance').textContent = `${Math.floor(r.distance)} m`
    $('#result-style').textContent = String(r.style)
    $('#result-cells').textContent = `+${r.cells} (${r.totalCells})`
    $('#new-best').hidden = !r.newBest
    this.popups.replaceChildren()
    this.show('results')
  }
}

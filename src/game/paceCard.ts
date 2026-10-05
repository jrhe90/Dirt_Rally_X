import type { CodriverLanguage } from './audio/codriverClips'
import type { SpokenCall } from './audio/codriver'
import type { ClipKey } from './audio/paceNotes'

const SVG_NS = 'http://www.w3.org/2000/svg'
const HOLD_MS = 2600

const LABELS: Record<CodriverLanguage, Partial<Record<ClipKey, string>>> = {
  zh: {
    long: '长弯', tightens: '收紧', opens: '放开', crest: '坡顶', overJump: '飞坡', caution: '注意',
    into: '接', and: '然后', walls: '石墙', jump: '飞坡', tarmac: '柏油', gravel: '砂石',
    lap2: '第二圈', finalLap: '最后一圈', finish: '冲线',
    d30: '30', d50: '50', d80: '80', d100: '100', d150: '150', d200: '200',
  },
  en: {
    long: 'LONG', tightens: 'TIGHTENS', opens: 'OPENS', crest: 'CREST', overJump: 'JUMP', caution: 'CAUTION',
    into: 'INTO', and: 'AND', walls: 'WALLS', jump: 'JUMP', tarmac: 'TARMAC', gravel: 'GRAVEL',
    lap2: 'LAP 2', finalLap: 'FINAL LAP', finish: 'FINISH',
    d30: '30', d50: '50', d80: '80', d100: '100', d150: '150', d200: '200',
  },
}

const LINKS = new Set<ClipKey>(['into', 'and', 'd30', 'd50', 'd80', 'd100', 'd150', 'd200', 'finish'])
/** Turn angle (degrees) and radius of the arrow glyph per severity. */
const ARROW: [number, number][] = [
  [0, 0],
  [170, 8],
  [140, 11],
  [110, 14],
  [80, 18],
  [55, 24],
  [32, 34],
]

/** Curved arrow like a pace-note symbol: tighter severities bend further. */
function arrowSvg(direction: 'left' | 'right', severity: number): SVGSVGElement {
  const [turnDeg, radius] = ARROW[severity]
  const turn = (turnDeg * Math.PI) / 180
  const steps = 24
  let x = 0
  let y = 0
  let heading = -Math.PI / 2
  const pts: [number, number][] = [[0, 14], [0, 0]]
  for (let i = 0; i < steps; i++) {
    heading += turn / steps
    x += Math.cos(heading) * ((radius * turn) / steps)
    y += Math.sin(heading) * ((radius * turn) / steps)
    pts.push([x, y])
  }
  const dir = [Math.cos(heading), Math.sin(heading)]
  const head = [
    [x + dir[0] * 9, y + dir[1] * 9],
    [x - dir[1] * 7, y + dir[0] * 7],
    [x + dir[1] * 7, y - dir[0] * 7],
  ]

  const all = [...pts, ...head]
  const flip = direction === 'left' ? -1 : 1
  const xs = all.map((p) => p[0] * flip)
  const ys = all.map((p) => p[1])
  const pad = 6
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const w = Math.max(...xs) + pad - minX
  const h = Math.max(...ys) + pad - minY
  const size = Math.max(w, h)

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `${(minX - (size - w) / 2).toFixed(1)} ${(minY - (size - h) / 2).toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}`)
  svg.setAttribute('class', 'pace-arrow')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M ' + pts.map(([px, py]) => `${(px * flip).toFixed(2)} ${py.toFixed(2)}`).join(' L '))
  const tip = document.createElementNS(SVG_NS, 'polygon')
  tip.setAttribute('points', head.map(([px, py]) => `${(px * flip).toFixed(2)},${py.toFixed(2)}`).join(' '))
  svg.append(path, tip)
  return svg
}

/** DiRT-style pace-note symbols at the top of the screen, synced to what the co-driver says. */
export class PaceCard {
  private readonly root = document.querySelector<HTMLElement>('#pacenotes')!
  private timer: number | undefined

  show = (spoken: SpokenCall[], lang: CodriverLanguage): void => {
    const labels = LABELS[lang]
    const shown = spoken.filter(({ note, calls }) => note || labels[calls[0]])
    const items = shown.flatMap(({ note, calls }) => {
      const el = document.createElement('div')
      el.className = 'pace-note'
      const main = document.createElement('div')
      main.className = 'pace-main'
      const tags: string[] = []
      let link: string | null = null

      if (note?.kind === 'corner') {
        main.append(arrowSvg(note.direction!, note.severity!))
        const num = document.createElement('span')
        num.className = 'pace-num'
        num.textContent = String(note.severity)
        main.append(num)
        el.dataset.severity = String(note.severity)
      } else {
        const word = document.createElement('span')
        word.className = 'pace-word'
        word.textContent = labels[calls.find((c) => !LINKS.has(c) && c !== 'caution' && c !== 'walls')!] ?? ''
        main.append(word)
      }

      for (const c of calls) {
        if (LINKS.has(c)) link = labels[c] ?? null
        else if (note?.kind === 'corner' || c === 'caution' || c === 'walls') {
          if (labels[c] && !(note?.kind === 'corner' && c.startsWith(note.direction!))) tags.push(labels[c]!)
        }
      }
      if (calls.includes('caution')) el.classList.add('caution')

      el.append(main)
      if (tags.length) {
        const t = document.createElement('div')
        t.className = 'pace-tags'
        t.textContent = tags.join(' · ')
        el.append(t)
      }
      if (!link) return [el]
      const join = document.createElement('div')
      join.className = 'pace-link'
      join.textContent = link
      return [el, join]
    })
    if (!items.length) return

    this.root.replaceChildren(...items)
    this.root.classList.add('visible')
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.hide(), HOLD_MS)
  }

  hide(): void {
    this.root.classList.remove('visible')
  }
}

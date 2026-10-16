import './flyer.css'
import { FlyerAudio } from './audio'
import { Hud, type Screen } from './hud'
import { Controls } from './input'
import { GameView, detectTier } from './render/view'
import { loadSave, vibrate, writeSave } from './save'
import { Autopilot } from './sim/bot'
import { STEP } from './sim/config'
import { createSim, distanceOf, scoreOf, startRun, step } from './sim/sim'
import type { SimEvent, SimState } from './sim/types'

const MAX_STEPS_PER_FRAME = 12
const SLOWMO_TIME = 1.1
const RESULTS_DELAY = 0.7

const params = new URLSearchParams(window.location.search)
/** Debug: the autopilot plays the run (also skips the title screen). */
const demo = params.has('demo')
/** Debug: start this many meters into the run, for its speed and difficulty. */
const startAt = Number(params.get('at') ?? 0) || 0
const fixedSeed = params.has('seed') ? Number(params.get('seed')) : null
/** Debug: only spawn this pattern (see sim/patterns.ts). */
const onlyPattern = params.get('pattern') ?? undefined
/** Debug: fast-forward this many seconds of a demo run before drawing. */
const fastForward = Number(params.get('ff') ?? 0) || 0
/** Debug: close-up of the car with no obstacles or UI; add `&fly` to hover. */
const showcase = params.has('showcase')
const showcaseFly = params.has('fly')

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const surface = document.querySelector<HTMLElement>('#surface')!

function fail(message: string): never {
  const el = document.querySelector<HTMLElement>('#error')!
  el.hidden = false
  el.textContent = message
  throw new Error(message)
}

let view: GameView
try {
  view = new GameView(canvas, detectTier())
} catch {
  fail('WebGL is not available in this browser, so the game cannot be drawn.')
}

const save = loadSave()
const hud = new Hud()
const controls = new Controls(surface)
let audio: FlyerAudio | null = null

let screen: Screen = 'title'
let sim = newSim()
let pilot: Autopilot | null = new Autopilot(60)
let slowmo = 0
let resultsIn = -1
let accumulator = 0
let last = performance.now()
let crashCause: SimEvent & { type: 'crash' } = { type: 'crash', kind: 'ground' }

function newSim(): SimState {
  const s = createSim(fixedSeed ?? (Math.random() * 2 ** 31) | 0)
  s.onlyPattern = onlyPattern
  return s
}

function ensureAudio(): FlyerAudio {
  if (!audio) {
    audio = new FlyerAudio()
    audio.setMuted(save.muted)
    audio.setMusic(save.music)
  }
  audio.start()
  return audio
}

function setScreen(next: Screen): void {
  screen = next
  hud.show(next)
  controls.enabled = next === 'title' || next === 'ready' || next === 'playing'
}

function begin(): void {
  if (screen === 'title') {
    sim = newSim()
    view.reset()
    pilot = demo ? new Autopilot(3000) : null
  }
  startRun(sim)
  if (startAt) sim.startX -= startAt
  slowmo = 0
  resultsIn = -1
  accumulator = 0
  hud.setBest(save.best)
  setScreen('playing')
  if (save.runs === 0) hud.showHint('Hold to climb, let go to drop', 3)
}

function toReady(): void {
  sim = newSim()
  view.reset()
  pilot = null
  slowmo = 0
  resultsIn = -1
  hud.setBest(save.best)
  hud.update(0, 0, 0)
  setScreen('ready')
}

function toTitle(): void {
  sim = newSim()
  startRun(sim)
  view.reset()
  pilot = new Autopilot(60)
  hud.setTitleStats(save.best, save.cells)
  setScreen('title')
}

function requestFullscreen(): void {
  if (!window.matchMedia('(pointer: coarse)').matches || document.fullscreenElement) return
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined)
}

controls.onPress = () => {
  ensureAudio()
  if (screen === 'title' || screen === 'ready') {
    requestFullscreen()
    begin()
  }
}

function pause(): void {
  if (screen !== 'playing' || sim.phase !== 'flying') return
  controls.releaseAll()
  setScreen('paused')
}
controls.onPause = () => (screen === 'paused' ? setScreen('playing') : pause())
document.querySelector('#pause')!.addEventListener('click', pause)
document.querySelector('#resume')!.addEventListener('click', () => {
  last = performance.now()
  setScreen('playing')
})
document.querySelector('#quit')!.addEventListener('click', toTitle)
document.querySelector('#retry')!.addEventListener('click', () => {
  ensureAudio()
  toReady()
})
document.querySelector('#menu')!.addEventListener('click', toTitle)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause()
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
  button.addEventListener('click', () => {
    if (button.dataset.toggle === 'sound') save.muted = !save.muted
    else save.music = !save.music
    writeSave(save)
    const a = ensureAudio()
    a.setMuted(save.muted)
    a.setMusic(save.music)
    hud.setToggles(!save.muted, save.music)
  })
}
window.addEventListener('resize', () => view.resize())

function finishRun(): void {
  const score = scoreOf(sim)
  const newBest = score > save.best
  save.best = Math.max(save.best, score)
  save.bestDistance = Math.max(save.bestDistance, Math.floor(distanceOf(sim)))
  save.cells += sim.cellsTaken
  save.runs++
  writeSave(save)
  hud.showResults({
    score,
    distance: distanceOf(sim),
    style: sim.style,
    cells: sim.cellsTaken,
    totalCells: save.cells,
    newBest,
    cause: crashCause.kind,
  })
  setScreen('results')
}

/** First-run tips, each shown once. */
function tutorial(events: readonly SimEvent[]): void {
  const once = (key: string, text: string, seconds = 4) => {
    if (save.hints.includes(key)) return
    save.hints.push(key)
    writeSave(save)
    hud.showHint(text, seconds)
  }
  const c = sim.car
  if (!c.grounded && c.airTime > 1.6 && distanceOf(sim) > 250) once('roll', 'Swipe up or double-tap in the air to barrel roll')
  for (const e of events) {
    if (e.type === 'land' && !e.clean && save.hints.includes('roll')) once('clean', 'Tap the jets just before touchdown for a clean landing and a speed boost')
    if (e.type === 'laserWarn') once('laser', 'Speed-trap lasers! Find the gap between the beams', 3)
    if (e.type === 'interceptorWarn') once('interceptor', 'Interceptor locking onto your height — move!', 3)
  }
}

function react(events: readonly SimEvent[]): void {
  view.handleEvents(events, sim)
  if (screen === 'title') return
  audio?.handle(events)
  const car = view.project(sim.car.x, sim.car.y + 1.4)
  hud.handle(events, car)
  for (const e of events) {
    if (e.type === 'crash') {
      crashCause = e
      slowmo = SLOWMO_TIME
      vibrate([70, 40, 110])
    } else if (e.type === 'nearMiss') vibrate(12)
    else if (e.type === 'land' && e.clean) vibrate(22)
    else if (e.type === 'interceptorLaunch') vibrate(30)
    else if (e.type === 'over') resultsIn = RESULTS_DELAY
  }
  if (screen === 'playing') tutorial(events)
}

function frame(now: number): void {
  const realDt = Math.min(0.05, (now - last) / 1000)
  last = now
  let dt = 0
  if (screen !== 'paused' && screen !== 'results') {
    let timeScale = 1
    if (slowmo > 0) {
      slowmo -= realDt
      timeScale = slowmo > 0.45 ? 0.25 : 0.25 + 0.75 * (1 - slowmo / 0.45)
    }
    dt = realDt * timeScale
    accumulator += dt
    let steps = 0
    while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      const input = showcase ? { hold: showcaseFly && sim.car.y < 3.2, roll: false } : pilot ? pilot.input(sim) : { hold: screen === 'playing' && controls.holding, roll: steps === 0 && controls.takeRoll() }
      step(sim, input)
      accumulator -= STEP
      steps++
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0
    const events = sim.events.splice(0)
    react(events)

    if (screen === 'title' && sim.phase === 'over') toTitle()
    if (resultsIn > 0) {
      resultsIn -= realDt
      if (resultsIn <= 0) finishRun()
    }
  }

  if (audio) {
    if (screen === 'title') audio.idle()
    else audio.update(sim)
  }
  hud.update(distanceOf(sim), sim.cellsTaken, sim.style)
  view.frame(sim, dt, realDt)
  requestAnimationFrame(frame)
}

hud.setToggles(!save.muted, save.music)
hud.setTitleStats(save.best, save.cells)
hud.setBest(save.best)
if (showcase) {
  begin()
  sim.spawnX = Infinity
  controls.enabled = false
  document.body.classList.add('showcase')
  Object.assign(window, { flyerDebug: () => ({ phase: sim.phase, y: sim.car.y, spool: sim.car.spool, screen, t: sim.t }) })
} else if (demo) {
  begin()
  for (let i = 0; i < fastForward / STEP && sim.phase === 'flying'; i++) step(sim, pilot!.input(sim))
  sim.events.length = 0
} else {
  toTitle()
}
requestAnimationFrame(frame)

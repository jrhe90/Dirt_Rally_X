import './autodrive.css'
import { AutoAudio } from './audio'
import { Hud } from './hud'
import { Input, type Action } from './input'
import { CAMERA_MODES, type CameraMode } from './render/camera'
import { View, detectTier } from './render/view'
import { AutopilotScreen } from './screen'
import { EGO, kmh, STEP } from './sim/config'
import { Autopilot } from './sim/fsd/autopilot'
import { PROFILES, type ProfileName } from './sim/fsd/profiles'
import { startPursuit } from './sim/police'
import type { DriveCommand, Mode, SimState } from './sim/types'
import { egoAccelLimit, egoGrip } from './sim/vehicle'
import { createSim, step } from './sim/world'

const MAX_STEPS = 10
const params = new URLSearchParams(window.location.search)
const demo = params.has('demo')
const debugHeat = Number(params.get('heat') ?? 0) || 0
const fixedSeed = params.has('seed') ? Number(params.get('seed')) : null
const debug = params.has('debug')
/** Debug: simulate this many seconds before the first frame (with ?demo). */
const fastForward = Number(params.get('ff') ?? 0) || 0
/** Debug: start in this camera mode. */
const startCam = params.get('cam')
const forcedProfile = params.get('profile') as ProfileName | null
const forcedMode = params.get('mode') as Mode | null
/** Debug: hide the HUD (for screenshots). */
const noHud = params.has('nohud')

type Screen = 'title' | 'playing' | 'paused' | 'over'

const PROFILE_HINTS: Record<ProfileName, string> = {
  chill: 'Keeps to the limit, leaves long gaps, changes lanes only when it really pays. Police leave you alone.',
  standard: 'A little over the limit, passes slower traffic and moves back right. Stays just under the speed cameras.',
  hurry: 'Well over the limit with tight gaps and quick lane changes. Expect a pursuit.',
  pursuit: 'Flat out. Threads traffic, uses the shoulder, steers around spikes, roadblocks and rams.',
}

const STORE_KEY = 'autopursuit:v1'
type Save = { mode: Mode; profile: ProfileName; music: boolean; muted: boolean; best: number }
function load(): Save {
  const fallback: Save = { mode: 'pursuit', profile: 'standard', music: true, muted: false, best: 0 }
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') }
  } catch {
    return fallback
  }
}
function persist(s: Save): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
let view: View
try {
  view = new View(canvas, detectTier())
} catch {
  const el = document.querySelector<HTMLElement>('#error')!
  el.hidden = false
  el.textContent = 'WebGL is not available in this browser, so the game cannot be drawn.'
  throw new Error('no webgl')
}

const save = load()
const input = new Input()
const hud = new Hud()
const apScreen = new AutopilotScreen(document.querySelector<HTMLCanvasElement>('#ap-screen')!)
let audio: AutoAudio | null = null
let screen: Screen = 'title'
let sim!: SimState
let ap = new Autopilot()
let accumulator = 0
let last = performance.now()
let reverse = false
let stoppedBrake = 0
let overTimer = -1

function ensureAudio(): AutoAudio {
  if (!audio) {
    audio = new AutoAudio()
    audio.setMuted(save.muted)
    audio.setMusic(save.music)
  }
  audio.start()
  return audio
}

function newRun(mode: Mode, profile: ProfileName, engaged: boolean): void {
  sim = createSim(fixedSeed ?? (Math.random() * 2 ** 31) | 0, mode)
  ap = new Autopilot()
  ap.setProfile(profile)
  ap.reset(sim)
  if (engaged) ap.engage(sim)
  view.reset(sim)
  hud.reset()
  reverse = false
  overTimer = -1
  accumulator = 0
}

function setScreen(next: Screen): void {
  screen = next
  document.querySelector<HTMLElement>('#title')!.hidden = next !== 'title'
  document.querySelector<HTMLElement>('#paused')!.hidden = next !== 'paused'
  document.querySelector<HTMLElement>('#results')!.hidden = next !== 'over'
  document.querySelector<HTMLElement>('#hud')!.hidden = next === 'title' || noHud
}

// Title screen setup buttons.
function refreshSetup(): void {
  for (const seg of document.querySelectorAll<HTMLElement>('.seg')) {
    const key = seg.dataset.setting as 'mode' | 'profile'
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.value === save[key]))
  }
  document.querySelector('#profile-hint')!.textContent = PROFILE_HINTS[save.profile]
}
for (const seg of document.querySelectorAll<HTMLElement>('.seg')) {
  for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      const key = seg.dataset.setting as 'mode' | 'profile'
      if (key === 'mode') save.mode = b.dataset.value as Mode
      else save.profile = b.dataset.value as ProfileName
      persist(save)
      refreshSetup()
      ensureAudio()
    })
  }
}
refreshSetup()

function start(): void {
  ensureAudio()
  if (forcedProfile && forcedProfile in PROFILES) save.profile = forcedProfile
  if (forcedMode === 'pursuit' || forcedMode === 'cruise') save.mode = forcedMode
  newRun(save.mode, save.profile, true)
  if (debugHeat && save.mode === 'pursuit') {
    startPursuit(sim)
    sim.heat = debugHeat
  }
  view.rig.mode = (CAMERA_MODES as string[]).includes(startCam ?? '') ? (startCam as CameraMode) : 'chase'
  view.rig.cut()
  setScreen('playing')
  hud.showBanner(save.mode === 'pursuit' ? 'HOT PURSUIT' : 'FREE DRIVE', `AUTOPILOT · ${PROFILES[save.profile].label}`, 'blue', 2.2)
  audio?.engaged(true)
}

document.querySelector('#setup')!.addEventListener('submit', (e) => {
  e.preventDefault()
  start()
})
document.querySelector('#retry')!.addEventListener('click', start)
document.querySelector('#menu')!.addEventListener('click', toTitle)
document.querySelector('#resume')!.addEventListener('click', () => {
  last = performance.now()
  setScreen('playing')
})
document.querySelector('#quit')!.addEventListener('click', toTitle)
const musicButton = document.querySelector<HTMLButtonElement>('#toggle-music')!
const soundButton = document.querySelector<HTMLButtonElement>('#toggle-sound')!
function refreshToggles(): void {
  musicButton.textContent = save.music ? 'MUSIC ON' : 'MUSIC OFF'
  soundButton.textContent = save.muted ? 'SOUND OFF' : 'SOUND ON'
}
musicButton.addEventListener('click', () => {
  save.music = !save.music
  persist(save)
  ensureAudio().setMusic(save.music)
  refreshToggles()
})
soundButton.addEventListener('click', () => {
  save.muted = !save.muted
  persist(save)
  ensureAudio().setMuted(save.muted)
  refreshToggles()
})
refreshToggles()

function toTitle(): void {
  // Attract mode: the autopilot drives free, the camera orbits.
  newRun('cruise', 'hurry', true)
  view.rig.mode = 'orbit'
  view.rig.cut()
  setScreen('title')
  audio?.silence()
}

window.addEventListener('resize', () => view.resize())
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'playing') setScreen('paused')
})
input.onAny = () => {
  if (audio) audio.start()
}

function finish(kind: 'busted' | 'wrecked'): void {
  const best = sim.bounty > save.best
  save.best = Math.max(save.best, Math.round(sim.bounty))
  persist(save)
  const res = document.querySelector<HTMLElement>('#results')!
  res.className = `screen results ${kind}`
  document.querySelector('#result-kind')!.textContent = kind === 'busted' ? 'BUSTED' : 'WRECKED'
  document.querySelector('#result-bounty')!.textContent = Math.round(sim.bounty).toLocaleString('en-US')
  const rows: [string, string][] = [
    ['Distance', `${(sim.ego.odometer / 1000).toFixed(2)} km`],
    ['Top speed', `${Math.round(kmh(sim.stats.maxSpeed))} km/h`],
    ['Escapes', String(sim.stats.escapes)],
    ['Police taken out', String(sim.stats.takedowns)],
    ['Near misses', String(sim.stats.nearMisses)],
    ['Collisions', String(sim.stats.collisions)],
    ['Interventions', String(sim.stats.interventions)],
    ['Best bounty', `${save.best.toLocaleString('en-US')}${best ? '  ★ NEW' : ''}`],
  ]
  const dl = document.querySelector('#result-rows')!
  dl.replaceChildren()
  for (const [k, v] of rows) {
    const wrap = document.createElement('div')
    wrap.style.display = 'contents'
    const dt = document.createElement('dt')
    dt.textContent = k
    const dd = document.createElement('dd')
    dd.textContent = v
    wrap.append(dt, dd)
    dl.append(wrap)
  }
  setScreen('over')
}

function disengage(byDriver: boolean): void {
  if (!ap.engaged) return
  ap.disengage()
  if (byDriver && sim.ego.v > 2) {
    sim.stats.interventions++
    sim.cleanDistance = 0
  }
  audio?.engaged(false)
}

function handle(action: Action): void {
  if (screen === 'title') {
    if (action === 'start') start()
    return
  }
  if (screen === 'over') {
    if (action === 'start' || action === 'restart') start()
    return
  }
  if (action === 'pause') {
    if (screen === 'playing') setScreen('paused')
    else if (screen === 'paused') {
      last = performance.now()
      setScreen('playing')
    }
    return
  }
  if (screen !== 'playing') return
  switch (action) {
    case 'autopilot':
      if (ap.engaged) disengage(false)
      else if (sim.phase === 'drive') {
        ap.engage(sim)
        audio?.engaged(true)
      }
      break
    case 'laneLeft':
    case 'laneRight':
      if (ap.engaged) {
        ap.requestLaneChange(action === 'laneLeft' ? 1 : -1)
        audio?.chime()
      }
      break
    case 'speedUp':
    case 'speedDown':
      ap.adjustSpeed(action === 'speedUp' ? 5 : -5)
      audio?.chime()
      break
    case 'profile1':
    case 'profile2':
    case 'profile3':
    case 'profile4': {
      const name = (['chill', 'standard', 'hurry', 'pursuit'] as const)[Number(action.slice(-1)) - 1]
      ap.setProfile(name)
      hud.popup(`${PROFILES[name].label} PROFILE`)
      audio?.chime()
      break
    }
    case 'camera':
      hud.popup(`CAMERA · ${view.rig.next().toUpperCase()}`)
      break
    case 'overlay':
      view.overlay.enabled = !view.overlay.enabled
      hud.popup(view.overlay.enabled ? 'AUTOPILOT VIEW ON' : 'AUTOPILOT VIEW OFF')
      break
    case 'alternatives':
      view.overlay.showAlternatives = !view.overlay.showAlternatives
      break
    case 'restart':
      start()
      break
    case 'music':
      save.music = !save.music
      persist(save)
      ensureAudio().setMusic(save.music)
      refreshToggles()
      break
    case 'hud':
      document.querySelector<HTMLElement>('#hud')!.style.opacity = document.querySelector<HTMLElement>('#hud')!.style.opacity === '0' ? '' : '0'
      break
    default:
      break
  }
}

/** Driver inputs to a command; with the autopilot engaged, the throttle can add speed. */
function command(dt: number): DriveCommand {
  const e = sim.ego
  const playing = screen === 'playing'
  if (playing && ap.engaged) {
    if (input.brake > 0.1 || input.takeOver) {
      disengage(true)
      hud.popup('AUTOPILOT DISENGAGED')
    }
  }
  const auto = ap.step(sim)
  sim.autopilot = ap.engaged
  if (auto && ap.engaged) {
    if (playing && input.throttle > 0) auto.accel = Math.max(auto.accel, input.throttle * egoAccelLimit(e.v, e.tiresBlown))
    return auto
  }
  if (!playing) return { accel: -3, steer: 0 }
  // Manual: steering asks for a fraction of the available cornering grip.
  const v = Math.max(4, Math.abs(e.v))
  const latMax = egoGrip(e) * 0.82
  const kappa = (input.steer * latMax) / (v * v)
  const steer = Math.max(-EGO.maxSteer, Math.min(EGO.maxSteer, Math.atan(EGO.wheelbase * kappa))) * Math.sign(e.v || 1)
  // Hold the brake at a standstill to engage reverse; throttle returns to drive.
  if (input.brake > 0.1 && Math.abs(e.v) < 0.3) stoppedBrake += dt
  else stoppedBrake = 0
  if (stoppedBrake > 0.45) reverse = true
  if (input.throttle > 0.1 && e.v > -0.3) reverse = false
  let accel: number
  if (reverse) accel = input.brake > 0.1 ? -3.5 * input.brake : input.throttle > 0.1 ? 6 : 0
  else accel = input.throttle * EGO.maxAccel - input.brake * EGO.maxBrake
  return { accel, steer, reverse, signal: 0 }
}

function frame(now: number): void {
  requestAnimationFrame(frame)
  const realDt = Math.min(0.1, (now - last) / 1000)
  last = now
  input.update(realDt, ap.engaged)
  for (const a of input.actions()) handle(a)

  const running = screen === 'playing' || screen === 'title' || (screen === 'over' && overTimer >= 0)
  if (running) {
    accumulator += realDt
    let steps = 0
    while (accumulator >= STEP && steps < MAX_STEPS) {
      step(sim, command(STEP))
      accumulator -= STEP
      steps++
    }
    if (steps === MAX_STEPS) accumulator = 0
  }
  if (sim.events.length) {
    if (screen === 'playing') {
      audio?.handle(sim.events)
      hud.handle(sim.events)
    }
    view.handleEvents(sim.events, sim)
    sim.events.length = 0
  }
  if (screen === 'playing' && sim.phase !== 'drive' && overTimer < 0) {
    overTimer = 1.6
    disengage(false)
    hud.showBanner(sim.phase === 'busted' ? 'BUSTED' : 'WRECKED', '', sim.phase === 'busted' ? 'cop' : '', 1.6)
  }
  if (overTimer >= 0) {
    overTimer -= realDt
    if (overTimer < 0 && screen === 'playing') finish(sim.phase === 'busted' ? 'busted' : 'wrecked')
  }
  // Title attract mode: restart if it ever stalls or wrecks.
  if (screen === 'title' && (sim.phase !== 'drive' || sim.ego.damage > 0.5)) toTitle()

  view.frame(sim, ap, screen === 'paused' ? 0 : realDt)
  if (screen !== 'title') {
    apScreen.draw(sim, ap)
    hud.update(sim, ap, realDt)
  }
  if (audio) {
    if (screen === 'playing') audio.update(sim, ap, false)
    else audio.silence()
  }
}

if (debug) {
  // Console / automation access: autopursuit.sim, autopursuit.ap.
  Object.defineProperty(window, 'autopursuit', { value: { get sim() { return sim }, get ap() { return ap }, get screen() { return screen } } })
}

if (demo) {
  start()
  for (let i = 0; i < fastForward / STEP; i++) {
    sim.autopilot = ap.engaged
    step(sim, ap.step(sim) ?? { accel: 0, steer: 0 })
    sim.events.length = 0
  }
} else {
  toTitle()
}
requestAnimationFrame(frame)

import './style.css'
import * as THREE from 'three'
import { GameAudio, type RacePhase } from './game/audio/gameAudio'
import { loadAudioSettings, type CodriverSetting } from './game/audio/settings'
import { autopilot } from './game/autopilot'
import { CameraRig } from './game/camera'
import { DustSystem } from './game/dust'
import { loadAssets, type GameAssets } from './game/graphics/assets'
import { createEnvironment } from './game/graphics/environment'
import { PostFx } from './game/graphics/postfx'
import { detectQuality, type Quality } from './game/graphics/quality'
import { createRoad } from './game/graphics/road'
import { createSceneryVisuals } from './game/graphics/scenery'
import { createTerrainMesh } from './game/graphics/terrainMesh'
import { formatTime, Hud } from './game/hud'
import { initInput, readInput } from './game/input'
import { PaceCard } from './game/paceCard'
import { LAPS } from './game/race'
import { createStage, PHYSICS_STEP, type Stage } from './game/stage'
import { SURFACES } from './game/vehicle/config'
import { CARS, currentCar, loadCarChoice, nextCar, saveCarChoice, selectCar, type CarSpec } from './game/vehicle/cars'
import { CarModel } from './game/vehicle/carModel'
import type { DriveControls } from './game/vehicle/vehicle'

const COUNTDOWN = 3
const MAX_STEPS_PER_FRAME = 8
const FLIPPED_HINT_DELAY = 2

const overlay = document.querySelector<HTMLDivElement>('#loading')!
const overlayStatus = overlay.querySelector<HTMLDivElement>('.overlay-status')!
const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const params = new URLSearchParams(window.location.search)
const demo = params.has('demo')
/** Debug aid: start the car this many meters into the stage. */
const startAt = Number(params.get('at') ?? NaN)
/** Debug aid: frame the car from the side or front instead of the chase camera. */
const debugView = params.get('view')
const DEBUG_VIEWS: Record<string, THREE.Vector3> = {
  side: new THREE.Vector3(-5.2, 0.7, 1.2),
  front: new THREE.Vector3(-2.4, 0.9, 5.6),
}

function fail(message: string): never {
  overlay.classList.add('error')
  overlayStatus.textContent = message
  throw new Error(message)
}

function createRenderer(quality: Quality): THREE.WebGLRenderer {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    })
    renderer.setPixelRatio(quality.pixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    return renderer
  } catch {
    return fail('WebGL is not available in this browser, so the stage cannot be drawn.')
  }
}

/** Car cards on the start screen; `onPick` swaps the car behind the overlay. */
function buildCarPicker(onPick: (car: CarSpec) => void): void {
  const picker = overlay.querySelector<HTMLDivElement>('.car-picker')!
  const cards = CARS.map((car) => {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'car-card'
    card.setAttribute('role', 'radio')
    card.dataset.car = car.id
    card.style.setProperty('--car-base', car.livery.base)
    card.style.setProperty('--car-primary', car.livery.primary)
    const swatch = document.createElement('span')
    swatch.className = 'car-swatch'
    swatch.setAttribute('aria-hidden', 'true')
    const name = document.createElement('span')
    name.className = 'car-name'
    name.textContent = car.name
    const tag = document.createElement('span')
    tag.className = 'car-tag'
    tag.textContent = car.tagline
    const desc = document.createElement('span')
    desc.className = 'car-desc'
    desc.textContent = car.description
    card.append(swatch, name, tag, desc)
    card.addEventListener('click', () => {
      onPick(car)
      sync()
    })
    picker.appendChild(card)
    return card
  })
  const sync = () => {
    for (const card of cards) card.setAttribute('aria-checked', String(card.dataset.car === currentCar().id))
  }
  sync()
}

/** Start screen with car, co-driver and music choices; resolves on Start (a user gesture, so audio can unlock). */
function waitForStart(audio: GameAudio): Promise<void> {
  const form = overlay.querySelector<HTMLFormElement>('.overlay-start')!
  const groups = form.querySelectorAll<HTMLElement>('[data-setting]')
  const sync = () => {
    const { codriver, music } = audio.current
    for (const group of groups) {
      const value = group.dataset.setting === 'codriver' ? codriver : music ? 'on' : 'off'
      for (const b of group.querySelectorAll<HTMLButtonElement>('button')) {
        b.setAttribute('aria-pressed', String(b.dataset.value === value))
      }
    }
  }
  for (const group of groups) {
    group.addEventListener('click', (e) => {
      const value = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.value
      if (!value) return
      const settings = audio.current
      if (group.dataset.setting === 'codriver') settings.codriver = value as CodriverSetting
      else settings.music = value === 'on'
      audio.update(settings)
      sync()
    })
  }
  sync()
  overlay.classList.add('ready')
  form.hidden = false
  form.querySelector<HTMLButtonElement>('.start-button')!.focus()

  return new Promise((resolve) => {
    form.addEventListener(
      'submit',
      (e) => {
        e.preventDefault()
        audio.start()
        resolve()
      },
      { once: true },
    )
  })
}

function buildScene(renderer: THREE.WebGLRenderer, stage: Stage, assets: GameAssets, quality: Quality) {
  const scene = new THREE.Scene()
  const env = createEnvironment(renderer, scene, assets.hdr, quality)
  scene.add(createTerrainMesh(stage.terrain, assets))
  scene.add(createRoad(stage.track, assets))
  const scenery = createSceneryVisuals(stage.scenery, stage.terrain, stage.track, assets, quality.grassCount)
  scene.add(scenery.group)
  return { scene, env, scenery }
}

async function main() {
  selectCar(loadCarChoice(params))
  const quality = detectQuality()
  const renderer = createRenderer(quality)

  overlayStatus.textContent = 'Loading textures and lighting…'
  const assetsPromise = loadAssets(renderer, (loaded, total) => {
    overlayStatus.textContent = `Loading textures and lighting… ${Math.round((loaded / total) * 100)}%`
  }).catch((err) => {
    console.error(err)
    fail('The stage textures could not be loaded. Run `npm run fetch-assets`, then reload.')
  })

  let stage: Stage
  try {
    stage = await createStage()
  } catch (err) {
    console.error(err)
    fail('The physics engine failed to start. Try reloading the page or using a recent desktop browser.')
  }
  const assets = await assetsPromise
  overlayStatus.textContent = 'Building the stage…'
  await new Promise((r) => setTimeout(r, 0))

  const { world, vehicle, race, terrain } = stage
  const { scene, env, scenery } = buildScene(renderer, stage, assets, quality)
  let car = new CarModel(currentCar().livery)
  scene.add(car.group)
  const dust = new DustSystem(quality.dustParticles)
  scene.add(dust.points)

  const rig = new CameraRig(window.innerWidth / window.innerHeight, terrain)
  const post = new PostFx(renderer, scene, rig.camera, quality)
  const hud = new Hud()
  const paceCard = new PaceCard()
  const audio = new GameAudio(stage.track, LAPS, loadAudioSettings(params), paceCard.show)
  void audio.preload()
  initInput(document.querySelector('#touch'))

  const soundButton = document.querySelector<HTMLButtonElement>('#touch-sound')!
  soundButton.addEventListener('click', () => {
    audio.start()
    const muted = audio.toggleMute()
    soundButton.setAttribute('aria-pressed', String(muted))
    soundButton.textContent = muted ? 'MUTED' : 'SOUND'
  })

  const resize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h)
    post.setSize(w, h)
    rig.camera.aspect = w / h
    rig.camera.updateProjectionMatrix()
    dust.setViewport(h * renderer.getPixelRatio(), rig.camera.fov)
  }
  window.addEventListener('resize', resize)
  resize()

  let phase: RacePhase = 'waiting'
  let countdown = COUNTDOWN
  let accumulator = 0
  let flippedFor = 0
  let lastCount = -1
  let dirt = 0.3

  const startPose = () =>
    Number.isFinite(startAt) ? race.recoveryPose(stage.track.pointAt(startAt).position) : race.startPose()

  const placeCar = (pose: { position: THREE.Vector3; yaw: number }) => {
    vehicle.reset(pose.position, pose.yaw)
    car.sync(vehicle)
    rig.snap(vehicle)
  }

  const changeCar = (spec: CarSpec) => {
    selectCar(spec)
    saveCarChoice(spec)
    vehicle.applyCar()
    scene.remove(car.group)
    car.dispose()
    car = new CarModel(spec.livery)
    scene.add(car.group)
    hud.buildTacho()
  }

  const restart = () => {
    race.reset()
    placeCar(startPose())
    phase = 'countdown'
    countdown = COUNTDOWN
    lastCount = -1
    paceCard.hide()
    audio.restart(race.progress)
  }

  const recover = () => {
    if (phase === 'finished') return restart()
    placeCar(race.recoveryPose(vehicle.position))
    flippedFor = 0
    hud.hide()
    audio.recovered(race.progress)
  }

  placeCar(startPose())
  // Compile every shader before the overlay fades so the first frames do not hitch.
  await renderer.compileAsync(scene, rig.camera)

  const HOLD: DriveControls = { throttle: 0, brake: 0, steer: 0, handbrake: 1 }
  const STOP: DriveControls = { throttle: 0, brake: 1, steer: 0, handbrake: 0 }
  const timer = new THREE.Timer()
  timer.connect(document)

  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp)
    const dt = Math.min(timer.getDelta(), 0.05)
    const input = readInput(dt)

    if (phase !== 'waiting') {
      if (input.restart) restart()
      else if (input.recover) recover()
    }
    if (input.cycleCamera) rig.cycle()
    if (input.toggleMusic) hud.toast(audio.toggleMusic())
    if (input.cycleCodriver) hud.toast(audio.cycleCodriver())
    if (input.cycleCar && phase !== 'waiting') {
      changeCar(nextCar(currentCar()))
      restart()
      hud.toast(currentCar().name.toUpperCase())
    }

    if (phase === 'countdown') {
      countdown -= dt
      const n = Math.ceil(countdown)
      if (n !== lastCount && n > 0) {
        hud.show(String(n))
        audio.countdown(n)
        lastCount = n
      }
      if (countdown <= 0) {
        phase = 'racing'
        hud.show('GO', '', 700)
        audio.countdown(0)
      }
    }

    const driver = demo ? autopilot(stage.track, vehicle, race.trackIndex) : input
    const controls = phase === 'racing' ? driver : phase === 'countdown' ? HOLD : STOP
    accumulator += dt
    let steps = 0
    while (accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME) {
      vehicle.step(PHYSICS_STEP, controls)
      world.step()
      accumulator -= PHYSICS_STEP
      steps++
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0

    const pos = vehicle.position
    race.update(dt, pos, phase === 'racing')

    if (phase === 'racing' && race.finished) {
      phase = 'finished'
      hud.show('STAGE CLEAR', `${formatTime(race.time)} · press T or RESET to run it again`)
      audio.finished()
    }

    if (phase === 'racing') {
      const flipped = vehicle.up.y < 0.3 && vehicle.velocity.length() < 3
      flippedFor = flipped ? flippedFor + dt : 0
      if (flippedFor > FLIPPED_HINT_DELAY && flippedFor - dt <= FLIPPED_HINT_DELAY) {
        hud.show('STUCK?', 'Press R or RESET to get back on the road')
      }
      if (pos.y < terrain.heightAt(pos.x, pos.z) - 4) recover()
    }

    const speed = vehicle.velocity.length()
    if (vehicle.surface) dirt += dt * speed * SURFACES[vehicle.surface].dust * 0.0012
    car.setDirt(Math.min(dirt, 0.95))
    car.setBraking(controls.brake > 0.1)
    car.sync(vehicle)
    dust.emitFromVehicle(vehicle, dt)
    dust.update(dt)
    rig.update(dt, vehicle)
    if (debugView && DEBUG_VIEWS[debugView]) {
      rig.camera.position.copy(DEBUG_VIEWS[debugView]).applyQuaternion(car.group.quaternion).add(pos)
      rig.camera.lookAt(pos)
    }
    dust.setViewport(window.innerHeight * renderer.getPixelRatio(), rig.camera.fov)
    env.follow(pos)
    scenery.update(timer.getElapsed())

    hud.update({
      speedKmh: speed * 3.6,
      gear: vehicle.gear,
      rpm: vehicle.rpm,
      time: race.time,
      lap: race.lap,
      stageProgress: race.stageProgress,
      lapTimes: race.lapTimes,
      currentLapTime: race.currentLapTime,
      surface: vehicle.surface,
    })

    audio.frame(phase, race.progress, speed)
    post.render(dt)
  })

  if (demo) {
    overlay.classList.add('done')
    audio.engine.unlockOnFirstGesture()
    audio.start()
  } else {
    buildCarPicker((spec) => {
      changeCar(spec)
      placeCar(startPose())
    })
    await waitForStart(audio)
    overlay.classList.add('done')
  }
  restart()
}

main()

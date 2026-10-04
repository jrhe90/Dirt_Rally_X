import './style.css'
import * as THREE from 'three'
import { CameraRig } from './game/camera'
import { DustSystem } from './game/dust'
import { formatTime, Hud } from './game/hud'
import { initInput, readInput } from './game/input'
import { createStage, PHYSICS_STEP, type Stage } from './game/stage'
import { CarModel } from './game/vehicle/carModel'
import type { DriveControls } from './game/vehicle/vehicle'

const COUNTDOWN = 3
const MAX_STEPS_PER_FRAME = 8
const FLIPPED_HINT_DELAY = 2

const overlay = document.querySelector<HTMLDivElement>('#loading')!
const overlayStatus = overlay.querySelector<HTMLDivElement>('.overlay-status')!
const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const coarse = window.matchMedia('(pointer: coarse)').matches

function fail(message: string): never {
  overlay.classList.add('error')
  overlayStatus.textContent = message
  throw new Error(message)
}

function createRenderer(): THREE.WebGLRenderer {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.outputColorSpace = THREE.SRGBColorSpace
    return renderer
  } catch {
    return fail('WebGL is not available in this browser, so the stage cannot be drawn.')
  }
}

function buildScene(stage: Stage) {
  const scene = new THREE.Scene()
  const fogColor = new THREE.Color(0xe6a874)
  scene.background = fogColor
  scene.fog = new THREE.FogExp2(fogColor, 0.0042)

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x6f9ac8) },
        mid: { value: new THREE.Color(0xf0c090) },
        horizon: { value: new THREE.Color(0xe6a874) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 mid;
        uniform vec3 horizon;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
          col = mix(col, top, smoothstep(0.15, 0.7, h));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
  )
  scene.add(sky)

  const sun = new THREE.DirectionalLight(0xffd6a8, 2.6)
  sun.castShadow = true
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 160
  sun.shadow.camera.left = -45
  sun.shadow.camera.right = 45
  sun.shadow.camera.top = 45
  sun.shadow.camera.bottom = -45
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  scene.add(sun, sun.target)
  scene.add(new THREE.HemisphereLight(0xffd8b0, 0x5a6a38, 0.9))
  scene.add(new THREE.AmbientLight(0xc4a070, 0.35))

  scene.add(stage.terrain.createMesh())
  scene.add(stage.track.createMeshes())
  scene.add(stage.scenery.createMeshes())

  return { scene, sun, sky }
}

async function main() {
  const renderer = createRenderer()

  let stage: Stage
  try {
    stage = await createStage()
  } catch (err) {
    console.error(err)
    fail('The physics engine failed to start. Try reloading the page or using a recent desktop browser.')
  }

  const { world, vehicle, race, terrain } = stage
  const { scene, sun, sky } = buildScene(stage)
  const car = new CarModel()
  scene.add(car.group)
  const dust = new DustSystem(coarse ? 700 : 1800)
  scene.add(dust.points)

  const rig = new CameraRig(window.innerWidth / window.innerHeight, terrain)
  const hud = new Hud()
  initInput(document.querySelector('#touch'))

  const resize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h)
    rig.camera.aspect = w / h
    rig.camera.updateProjectionMatrix()
    dust.setViewport(h * renderer.getPixelRatio(), rig.camera.fov)
  }
  window.addEventListener('resize', resize)
  resize()

  type Phase = 'countdown' | 'racing' | 'finished'
  let phase: Phase = 'countdown'
  let countdown = COUNTDOWN
  let accumulator = 0
  let flippedFor = 0
  let lastCount = -1

  const placeCar = (pose: { position: THREE.Vector3; yaw: number }) => {
    vehicle.reset(pose.position, pose.yaw)
    car.sync(vehicle)
    rig.snap(vehicle)
  }

  const restart = () => {
    race.reset()
    placeCar(race.startPose())
    phase = 'countdown'
    countdown = COUNTDOWN
    lastCount = -1
  }

  const recover = () => {
    if (phase === 'finished') return restart()
    placeCar(race.recoveryPose(vehicle.position))
    flippedFor = 0
    hud.hide()
  }

  restart()
  overlay.classList.add('done')

  const HOLD: DriveControls = { throttle: 0, brake: 0, steer: 0, handbrake: 1 }
  const STOP: DriveControls = { throttle: 0, brake: 1, steer: 0, handbrake: 0 }
  const clock = new THREE.Clock()

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05)
    const input = readInput(dt)

    if (input.restart) restart()
    else if (input.recover) recover()
    if (input.cycleCamera) rig.cycle()

    if (phase === 'countdown') {
      countdown -= dt
      const n = Math.ceil(countdown)
      if (n !== lastCount && n > 0) {
        hud.show(String(n))
        lastCount = n
      }
      if (countdown <= 0) {
        phase = 'racing'
        hud.show('GO', '', 700)
      }
    }

    const controls = phase === 'racing' ? input : phase === 'countdown' ? HOLD : STOP
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
    }

    if (phase === 'racing') {
      const flipped = vehicle.up.y < 0.3 && vehicle.velocity.length() < 3
      flippedFor = flipped ? flippedFor + dt : 0
      if (flippedFor > FLIPPED_HINT_DELAY && flippedFor - dt <= FLIPPED_HINT_DELAY) {
        hud.show('STUCK?', 'Press R or RESET to get back on the road')
      }
      if (pos.y < terrain.heightAt(pos.x, pos.z) - 4) recover()
    }

    car.sync(vehicle)
    dust.emitFromVehicle(vehicle, dt)
    dust.update(dt)
    rig.update(dt, vehicle)
    dust.setViewport(window.innerHeight * renderer.getPixelRatio(), rig.camera.fov)

    sun.position.set(pos.x + 50, pos.y + 70, pos.z + 30)
    sun.target.position.copy(pos)
    sky.position.copy(rig.camera.position)

    hud.update({
      speedKmh: vehicle.velocity.length() * 3.6,
      gear: vehicle.gear,
      rpm: vehicle.rpm,
      time: race.time,
      lap: race.lap,
      lapProgress: race.lapProgress,
      surface: vehicle.surface,
    })

    renderer.render(scene, rig.camera)
  })
}

main()

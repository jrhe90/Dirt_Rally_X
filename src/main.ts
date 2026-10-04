import './style.css'
import * as THREE from 'three'
import { Car } from './game/car'
import { DustSystem } from './game/dust'
import { initInput, readInput } from './game/input'
import { Track } from './game/track'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const speedEl = document.querySelector('#speed')!
const timeEl = document.querySelector('#time')!
const lapEl = document.querySelector('#lap')!
const messageEl = document.querySelector('#message')!

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
renderer.outputColorSpace = THREE.SRGBColorSpace

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xf0a060)
scene.fog = new THREE.FogExp2(0xe8a868, 0.0085)

// Sky dome gradient via large sphere
{
  const skyGeo = new THREE.SphereGeometry(400, 32, 16)
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0xf5b070) },
      midColor: { value: new THREE.Color(0xe89060) },
      bottomColor: { value: new THREE.Color(0xc4783a) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        vec3 col = mix(bottomColor, midColor, smoothstep(-0.2, 0.25, h));
        col = mix(col, topColor, smoothstep(0.2, 0.85, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  scene.add(new THREE.Mesh(skyGeo, skyMat))
}

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500,
)

// Lighting — late-afternoon rally stage
const sun = new THREE.DirectionalLight(0xffd2a0, 2.4)
sun.position.set(40, 55, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 10
sun.shadow.camera.far = 180
sun.shadow.camera.left = -80
sun.shadow.camera.right = 80
sun.shadow.camera.top = 80
sun.shadow.camera.bottom = -80
sun.shadow.bias = -0.0003
scene.add(sun)
scene.add(new THREE.AmbientLight(0xc4a070, 0.55))
scene.add(new THREE.HemisphereLight(0xffc090, 0x3a5a28, 0.45))

const track = new Track(scene)
const car = new Car(track)
scene.add(car.mesh)

const dust = new DustSystem()
scene.add(dust.points)

// Headlight cones (simple spots)
const headL = new THREE.SpotLight(0xffe0b0, 1.2, 40, 0.35, 0.4)
const headR = new THREE.SpotLight(0xffe0b0, 1.2, 40, 0.35, 0.4)
headL.castShadow = false
headR.castShadow = false
scene.add(headL, headR, headL.target, headR.target)

initInput()

let raceTime = 0
let racing = false
let countdown = 3.2
let bestTime = Number.POSITIVE_INFINITY
let wasReset = false

const camPos = new THREE.Vector3()
const camLook = new THREE.Vector3()

function showMessage(text: string, hideAfterMs?: number): void {
  messageEl.textContent = text
  messageEl.classList.remove('hidden')
  if (hideAfterMs != null) {
    window.setTimeout(() => messageEl.classList.add('hidden'), hideAfterMs)
  }
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

function updateHud(): void {
  const kmh = Math.round(Math.abs(car.speed) * 3.6)
  speedEl.textContent = String(kmh)
  timeEl.textContent = formatTime(raceTime)
  lapEl.textContent = `${Math.min(car.lap, 3)} / 3`
}

function placeCamera(dt: number): void {
  const forward = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading))
  const desired = car.mesh.position
    .clone()
    .addScaledVector(forward, -8.5)
    .add(new THREE.Vector3(0, 3.2, 0))

  // Look ahead through the corner
  const look = car.mesh.position
    .clone()
    .addScaledVector(forward, 10)
    .add(new THREE.Vector3(0, 1.2, 0))

  const lerp = 1 - Math.exp(-5 * dt)
  camPos.lerp(desired, lerp)
  camLook.lerp(look, lerp)
  camera.position.copy(camPos)
  camera.lookAt(camLook)

  // Headlights follow car
  const right = new THREE.Vector3(forward.z, 0, -forward.x)
  headL.position.copy(car.mesh.position).addScaledVector(right, -0.45).add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(forward, 1.5)
  headR.position.copy(car.mesh.position).addScaledVector(right, 0.45).add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(forward, 1.5)
  headL.target.position.copy(car.mesh.position).addScaledVector(forward, 20)
  headR.target.position.copy(car.mesh.position).addScaledVector(forward, 20)
  headL.target.updateMatrixWorld()
  headR.target.updateMatrixWorld()

  // Keep sun shadow near car
  sun.position.set(
    car.mesh.position.x + 40,
    car.mesh.position.y + 55,
    car.mesh.position.z + 20,
  )
  sun.target.position.copy(car.mesh.position)
  sun.target.updateMatrixWorld()
}

function resetRace(): void {
  car.reset()
  raceTime = 0
  racing = false
  countdown = 3.2
  showMessage('3')
  camPos.copy(car.mesh.position).add(new THREE.Vector3(0, 4, -10))
  camLook.copy(car.mesh.position)
}

resetRace()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

const clock = new THREE.Clock()

function tick(): void {
  const dt = Math.min(clock.getDelta(), 0.05)
  const input = readInput()

  if (input.reset && !wasReset) {
    resetRace()
  }
  wasReset = input.reset

  if (!racing && !car.finished) {
    countdown -= dt
    if (countdown > 2) showMessage('3')
    else if (countdown > 1) showMessage('2')
    else if (countdown > 0) showMessage('1')
    else {
      racing = true
      showMessage('GO', 700)
    }
  }

  if (racing && !car.finished) {
    car.update(dt, input)
    raceTime += dt
  } else if (car.finished) {
    car.update(dt, { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false })
    if (raceTime < bestTime) bestTime = raceTime
    showMessage(`STAGE CLEAR\n${formatTime(raceTime)}`)
  } else {
    // Countdown — hold still but allow camera settle
    car.update(0, { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false })
  }

  dust.emit(car.mesh.position, car.heading, car.speed, car.slip, dt)
  dust.update(dt)
  placeCamera(dt)
  updateHud()

  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

requestAnimationFrame(tick)

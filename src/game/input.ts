import type { DriveControls } from './vehicle/vehicle'

export type FrameInput = DriveControls & {
  /** Put the car back on the road. */
  recover: boolean
  /** Restart the stage from the line. */
  restart: boolean
  cycleCamera: boolean
  toggleMusic: boolean
  cycleCodriver: boolean
  cycleCar: boolean
}

type TouchControl = 'left' | 'right' | 'gas' | 'brake' | 'handbrake' | 'recover' | 'camera'

const PAD_DEADZONE = 0.12
const STEER_RATE = 3.2
const STEER_RETURN_RATE = 6
const PEDAL_RATE = 7

const keys = new Set<string>()
const keyEdges = new Set<string>()
const touch = new Set<TouchControl>()
const touchEdges = new Set<TouchControl>()
let prevPadButtons: boolean[] = []
let steer = 0
let throttle = 0
let brake = 0

const BLOCKED_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])

export function initInput(touchRoot: HTMLElement | null): void {
  window.addEventListener('keydown', (e) => {
    if (!e.repeat) keyEdges.add(e.code)
    keys.add(e.code)
    if (BLOCKED_KEYS.has(e.code)) e.preventDefault()
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => {
    keys.clear()
    touch.clear()
  })

  if (!touchRoot) return
  for (const el of touchRoot.querySelectorAll<HTMLElement>('[data-control]')) {
    const control = el.dataset.control as TouchControl
    const release = () => {
      touch.delete(control)
      el.classList.remove('active')
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      touch.add(control)
      touchEdges.add(control)
      el.classList.add('active')
    })
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
    el.addEventListener('lostpointercapture', release)
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }
}

function approach(current: number, target: number, rate: number, dt: number): number {
  const delta = target - current
  const step = rate * dt
  return Math.abs(delta) <= step ? target : current + Math.sign(delta) * step
}

function readGamepad() {
  let pads: (Gamepad | null)[] = []
  try {
    pads = navigator.getGamepads?.() ?? []
  } catch {
    // Embedded frames may not be allowed to use gamepads; keyboard and touch still work.
  }
  const pad = Array.from(pads).find((p) => p && p.connected)
  if (!pad) {
    prevPadButtons = []
    return null
  }

  const pressed = pad.buttons.map((b) => b.pressed)
  const edge = (i: number) => !!pressed[i] && !prevPadButtons[i]
  const raw = pad.axes[0] ?? 0
  const axis = Math.abs(raw) < PAD_DEADZONE ? 0 : Math.sign(raw) * ((Math.abs(raw) - PAD_DEADZONE) / (1 - PAD_DEADZONE))

  const result = {
    steer: axis,
    throttle: pad.buttons[7]?.value ?? 0,
    brake: pad.buttons[6]?.value ?? 0,
    handbrake: !!(pressed[0] || pressed[2]),
    recover: edge(3),
    restart: edge(9),
    cycleCamera: edge(5) || edge(4),
  }
  prevPadButtons = pressed
  return result
}

export function readInput(dt: number): FrameInput {
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || touch.has('left')
  const right = keys.has('KeyD') || keys.has('ArrowRight') || touch.has('right')
  const gas = keys.has('KeyW') || keys.has('ArrowUp') || touch.has('gas')
  const stop = keys.has('KeyS') || keys.has('ArrowDown') || touch.has('brake')

  const digitalSteer = (right ? 1 : 0) - (left ? 1 : 0)
  const returning = digitalSteer === 0 || Math.sign(digitalSteer) !== Math.sign(steer)
  steer = approach(steer, digitalSteer, returning ? STEER_RETURN_RATE : STEER_RATE, dt)
  throttle = approach(throttle, gas ? 1 : 0, PEDAL_RATE, dt)
  brake = approach(brake, stop ? 1 : 0, PEDAL_RATE, dt)

  const pad = readGamepad()
  const usePadSteer = pad && Math.abs(pad.steer) > 0 && digitalSteer === 0
  if (usePadSteer) steer = pad.steer

  const out: FrameInput = {
    steer,
    throttle: Math.max(throttle, pad?.throttle ?? 0),
    brake: Math.max(brake, pad?.brake ?? 0),
    handbrake: keys.has('Space') || touch.has('handbrake') || pad?.handbrake ? 1 : 0,
    recover: keyEdges.has('KeyR') || touchEdges.has('recover') || !!pad?.recover,
    restart: keyEdges.has('KeyT') || !!pad?.restart,
    cycleCamera: keyEdges.has('KeyC') || touchEdges.has('camera') || !!pad?.cycleCamera,
    toggleMusic: keyEdges.has('KeyM'),
    cycleCodriver: keyEdges.has('KeyN'),
    cycleCar: keyEdges.has('KeyV'),
  }

  keyEdges.clear()
  touchEdges.clear()
  return out
}

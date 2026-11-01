/**
 * Keyboard, gamepad and touch. Continuous inputs are throttle, brake and steering (smoothed for
 * keys). One-shot actions are queued. With the autopilot engaged a quick tap left/right asks for
 * a lane change (like flicking the indicator stalk), holding the direction or touching the
 * brake hands control back to the driver, and the throttle overrides the set speed.
 */

export type Action =
  | 'autopilot'
  | 'laneLeft'
  | 'laneRight'
  | 'speedUp'
  | 'speedDown'
  | 'camera'
  | 'overlay'
  | 'alternatives'
  | 'pause'
  | 'restart'
  | 'music'
  | 'mute'
  | 'hud'
  | 'profile1'
  | 'profile2'
  | 'profile3'
  | 'profile4'
  | 'start'

const KEY_ACTIONS: Record<string, Action> = {
  KeyF: 'autopilot',
  Enter: 'start',
  KeyQ: 'laneLeft',
  KeyE: 'laneRight',
  Equal: 'speedUp',
  NumpadAdd: 'speedUp',
  BracketRight: 'speedUp',
  Minus: 'speedDown',
  NumpadSubtract: 'speedDown',
  BracketLeft: 'speedDown',
  KeyC: 'camera',
  KeyV: 'overlay',
  KeyB: 'alternatives',
  Escape: 'pause',
  KeyP: 'pause',
  KeyT: 'restart',
  KeyM: 'music',
  KeyH: 'hud',
  Digit1: 'profile1',
  Digit2: 'profile2',
  Digit3: 'profile3',
  Digit4: 'profile4',
}

const THROTTLE = new Set(['KeyW', 'ArrowUp'])
const BRAKE = new Set(['KeyS', 'ArrowDown', 'Space'])
const LEFT = new Set(['KeyA', 'ArrowLeft'])
const RIGHT = new Set(['KeyD', 'ArrowRight'])
const TAP = 0.24

export class Input {
  throttle = 0
  brake = 0
  /** -1 (right) .. 1 (left), smoothed. */
  steer = 0
  /** How long a steering direction has been held, s. */
  steerHeld = 0
  /** True on the frame a steering hold crosses the tap threshold (take over). */
  takeOver = false
  private readonly keys = new Set<string>()
  private readonly touch = new Set<string>()
  private readonly queue: Action[] = []
  private readonly pad = { prev: [] as boolean[] }
  private padSteer = 0
  private padThrottle = 0
  private padBrake = 0
  /** When each steering source went down (keys, touch buttons, stick), ms. */
  private readonly downAt = new Map<string, number>()
  private padDir = 0
  private tookOver = false
  onAny: (() => void) | null = null

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat && !THROTTLE.has(e.code) && !BRAKE.has(e.code)) return
      const action = KEY_ACTIONS[e.code]
      if (action) {
        this.queue.push(action)
        e.preventDefault()
      }
      if (THROTTLE.has(e.code) || BRAKE.has(e.code) || LEFT.has(e.code) || RIGHT.has(e.code)) e.preventDefault()
      if (!this.keys.has(e.code) && (LEFT.has(e.code) || RIGHT.has(e.code))) this.press(LEFT.has(e.code) ? 'left' : 'right')
      this.keys.add(e.code)
      this.onAny?.()
    })
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code)
      if (LEFT.has(e.code) || RIGHT.has(e.code)) this.release(LEFT.has(e.code) ? 'left' : 'right')
    })
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.touch.clear()
      this.downAt.clear()
    })
    window.addEventListener('wheel', (e) => {
      if ((e.target as HTMLElement)?.closest?.('.screen')) return
      this.queue.push(e.deltaY < 0 ? 'speedUp' : 'speedDown')
    })
    for (const el of document.querySelectorAll<HTMLElement>('[data-hold]')) {
      const name = el.dataset.hold!
      const down = (e: PointerEvent) => {
        e.preventDefault()
        el.setPointerCapture?.(e.pointerId)
        if (!this.touch.has(name) && (name === 'left' || name === 'right')) this.press(`touch-${name}`)
        this.touch.add(name)
        el.classList.add('down')
        this.onAny?.()
      }
      const up = () => {
        if (this.touch.has(name) && (name === 'left' || name === 'right')) this.release(`touch-${name}`)
        this.touch.delete(name)
        el.classList.remove('down')
      }
      el.addEventListener('pointerdown', down)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
      el.addEventListener('lostpointercapture', up)
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-tap]')) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        this.queue.push(el.dataset.tap as Action)
        this.onAny?.()
      })
    }
  }

  private press(source: string): void {
    this.downAt.set(source, performance.now())
    this.tookOver = false
  }

  /** A quick tap of a direction is a lane-change request (the indicator stalk). */
  private release(source: string): void {
    const t0 = this.downAt.get(source)
    this.downAt.delete(source)
    if (t0 === undefined) return
    if (performance.now() - t0 < TAP * 1000) this.queue.push(source.endsWith('left') ? 'laneLeft' : 'laneRight')
  }

  private pollPad(): void {
    const pads = navigator.getGamepads?.() ?? []
    const gp = [...pads].find((p) => p && p.connected)
    if (!gp) {
      this.padSteer = this.padThrottle = this.padBrake = 0
      return
    }
    const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88)
    this.padSteer = -dead(gp.axes[0] ?? 0)
    this.padThrottle = gp.buttons[7]?.value ?? 0
    this.padBrake = gp.buttons[6]?.value ?? 0
    const map: [number, Action][] = [
      [3, 'autopilot'],
      [4, 'laneLeft'],
      [5, 'laneRight'],
      [12, 'speedUp'],
      [13, 'speedDown'],
      [2, 'camera'],
      [9, 'pause'],
      [8, 'restart'],
      [0, 'start'],
      [1, 'overlay'],
    ]
    for (const [i, action] of map) {
      const pressed = !!gp.buttons[i]?.pressed
      if (pressed && !this.pad.prev[i]) {
        this.queue.push(action)
        this.onAny?.()
      }
      this.pad.prev[i] = pressed
    }
  }

  update(dt: number, autopilotEngaged: boolean): void {
    this.pollPad()
    const any = (set: Set<string>) => [...set].some((k) => this.keys.has(k))
    const keyThrottle = any(THROTTLE) || this.touch.has('gas') ? 1 : 0
    const keyBrake = any(BRAKE) || this.touch.has('brake') ? 1 : 0
    this.throttle = Math.max(keyThrottle, this.padThrottle)
    this.brake = Math.max(keyBrake, this.padBrake)

    const l = any(LEFT) || this.touch.has('left')
    const r = any(RIGHT) || this.touch.has('right')
    const keyDir = l === r ? 0 : l ? 1 : -1
    // The stick behaves like keys for taps and holds.
    const padDir = Math.abs(this.padSteer) > 0.5 ? Math.sign(this.padSteer) : 0
    if (padDir !== this.padDir) {
      if (this.padDir !== 0) this.release(this.padDir > 0 ? 'pad-left' : 'pad-right')
      if (padDir !== 0) this.press(padDir > 0 ? 'pad-left' : 'pad-right')
      this.padDir = padDir
    }
    // Held past the tap time: the driver is steering. Touch arrows never take over while
    // the autopilot is engaged; on a phone they are the stalk.
    const now = performance.now()
    let held = 0
    for (const [source, t0] of this.downAt) {
      if (source.startsWith('touch') && autopilotEngaged) continue
      held = Math.max(held, (now - t0) / 1000)
    }
    this.steerHeld = held
    this.takeOver = false
    if (held >= TAP && !this.tookOver) {
      this.takeOver = true
      this.tookOver = true
    }

    const target = Math.abs(this.padSteer) > 0.01 ? this.padSteer : keyDir
    const rate = keyDir ? 3.2 : 6
    if (Math.abs(this.padSteer) > 0.01) this.steer = this.padSteer
    else this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer))
  }

  /** Steering is being actively held (not a tap). */
  get steering(): boolean {
    return this.steerHeld >= TAP || Math.abs(this.padSteer) > 0.25
  }


  actions(): Action[] {
    return this.queue.splice(0)
  }
}

/**
 * One-touch controls. Hold anywhere (touch, mouse, Space / ↑ / W) to fire the jets. Roll with a
 * quick upward swipe, a double tap, or Shift / → / D. Buttons in the HUD are excluded.
 */

const SWIPE_DISTANCE = 42
const SWIPE_TIME = 260
const DOUBLE_TAP_TIME = 280

const HOLD_KEYS = new Set(['Space', 'ArrowUp', 'KeyW'])
const ROLL_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'ArrowRight', 'KeyD'])

export class Controls {
  private readonly pointers = new Map<number, { y: number; t: number; swiped: boolean }>()
  private readonly keys = new Set<string>()
  private rollQueued = false
  private lastTap = 0
  /** Called on any press, before it is applied (for starting the run, unlocking audio). */
  onPress: (() => void) | null = null
  onPause: (() => void) | null = null
  enabled = true

  constructor(surface: HTMLElement) {
    surface.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, a, [data-ui]')) return
      e.preventDefault()
      surface.setPointerCapture?.(e.pointerId)
      const now = performance.now()
      if (now - this.lastTap < DOUBLE_TAP_TIME) this.rollQueued = true
      this.lastTap = now
      this.pointers.set(e.pointerId, { y: e.clientY, t: now, swiped: false })
      this.onPress?.()
    })
    surface.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId)
      if (!p || p.swiped) return
      if (p.y - e.clientY > SWIPE_DISTANCE && performance.now() - p.t < SWIPE_TIME) {
        p.swiped = true
        this.rollQueued = true
      }
    })
    const release = (e: PointerEvent) => this.pointers.delete(e.pointerId)
    surface.addEventListener('pointerup', release)
    surface.addEventListener('pointercancel', release)
    surface.addEventListener('lostpointercapture', release)
    surface.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause?.()
        return
      }
      if (!HOLD_KEYS.has(e.code) && !ROLL_KEYS.has(e.code)) return
      e.preventDefault()
      if (e.repeat) return
      this.keys.add(e.code)
      if (ROLL_KEYS.has(e.code)) this.rollQueued = true
      else this.onPress?.()
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.releaseAll())
  }

  releaseAll(): void {
    this.pointers.clear()
    this.keys.clear()
    this.rollQueued = false
  }

  get holding(): boolean {
    if (!this.enabled) return false
    if (this.pointers.size > 0) return true
    for (const k of this.keys) if (HOLD_KEYS.has(k)) return true
    return false
  }

  /** Roll request, consumed once. */
  takeRoll(): boolean {
    const r = this.rollQueued && this.enabled
    this.rollQueued = false
    return r
  }
}

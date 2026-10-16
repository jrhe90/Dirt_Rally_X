import { STEP } from './config'
import { step } from './sim'
import type { SimState } from './types'

/**
 * Look-ahead autopilot (hold / release only). Every 0.1 s it searches input sequences about
 * 1.3 s ahead on copies of the sim and picks the first action that survives. Used by the
 * fairness check and by the title screen's attract mode.
 */

export const DECISION_STEPS = Math.round(0.1 / STEP)
const DEPTH = 13

function advance(s: SimState, hold: boolean): boolean {
  for (let i = 0; i < DECISION_STEPS; i++) {
    step(s, { hold, roll: false })
    if (s.phase !== 'flying') return false
  }
  s.events.length = 0
  return true
}

/** Returns the action to take now, or null if no survivable sequence was found within `budget` sim copies. */
export function decide(s: SimState, previous: boolean, budget = Infinity): boolean | null {
  const visited = new Set<string>()
  let spent = 0
  const search = (state: SimState, depth: number, prefer: boolean): boolean => {
    for (const action of [prefer, !prefer]) {
      if (++spent > budget) return false
      const next = structuredClone(state)
      if (!advance(next, action)) continue
      if (depth === 1) return true
      const key = `${depth}:${Math.round(next.car.y * 2)}:${Math.round(next.car.vy / 1.5)}:${Math.round(next.car.spool * 3)}`
      if (visited.has(key)) continue
      visited.add(key)
      if (search(next, depth - 1, action)) return true
    }
    return false
  }
  // Cells don't affect survival; leaving them out makes every copy much cheaper.
  const root = structuredClone({ ...s, cells: [], events: [] })
  for (const action of [previous, !previous]) {
    const next = structuredClone(root)
    if (advance(next, action) && search(next, DEPTH - 1, action)) return action
  }
  return null
}

/** Stateful wrapper that re-decides every DECISION_STEPS sim steps. */
export class Autopilot {
  private hold = false
  private counter = 0
  private readonly budget: number

  constructor(budget = Infinity) {
    this.budget = budget
  }

  /** Call once per sim step, before stepping. */
  input(s: SimState): { hold: boolean; roll: boolean } {
    if (this.counter-- <= 0) {
      this.counter = DECISION_STEPS - 1
      this.hold = decide(s, this.hold, this.budget) ?? this.hold
    }
    return { hold: this.hold, roll: false }
  }
}

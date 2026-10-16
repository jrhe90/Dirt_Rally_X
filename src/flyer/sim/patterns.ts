import { difficultyAt, speedAt, TRUCK, TRUCK_WAKE_DISTANCE, WALL } from './config'
import { nextRandom, pick, randomInt, randomRange } from './rng'
import type { Obstacle, ObstacleKind, SimState } from './types'

/**
 * Hand-made obstacle patterns. Positions are authored in seconds of travel at the speed the car
 * will have when it gets there, so a pattern takes the same time to react to at any speed; only
 * fixed-size things (a 17 m truck) get quicker to pass. `scripts/flyer-check.ts` flies a bot
 * through every pattern to prove each one can be survived without rolling.
 */

const LASER_LANES = [1.2, 4.6, 8.0, 11.4] as const
const TRUCK_LENGTH = TRUCK.trailerLength + TRUCK.cabLength

export class Builder {
  readonly s: SimState
  readonly x0: number
  readonly speed: number
  readonly d: number
  private endT = 0
  private extraX = 0

  constructor(s: SimState, x0: number, speed: number, d: number) {
    this.s = s
    this.x0 = x0
    this.speed = speed
    this.d = d
  }

  x(t: number): number {
    return this.x0 + t * this.speed
  }

  rand(min = 0, max = 1): number {
    return randomRange(this.s, min, max)
  }

  chance(p: number): boolean {
    return nextRandom(this.s) < p
  }

  /** Seconds it takes to pass something this long. */
  pass(meters: number): number {
    return meters / this.speed
  }

  private add(kind: ObstacleKind, x: number, y: number, fields: Partial<Obstacle> = {}): Obstacle {
    const o: Obstacle = {
      id: this.s.nextId++,
      kind,
      x,
      y,
      vx: 0,
      a: 0,
      b: 0,
      c: 0,
      variant: 0,
      state: 'idle',
      stateT: 0,
      x0: x,
      x1: x,
      near: false,
      dodged: false,
      passed: false,
      ...fields,
    }
    this.s.obstacles.push(o)
    return o
  }

  /** Truck whose rear is reached at t. Moving trucks wake up near the car and pull away. */
  truck(t: number, moving = false, variant = randomInt(this.s, 0, 2)): number {
    const vx = moving ? Math.min(5, this.speed * 0.25) : 0
    this.add('truck', this.x(t), 0, { vx: 0, a: vx, variant })
    if (vx > 0) {
      const drift = (vx * (TRUCK_WAKE_DISTANCE + TRUCK_LENGTH + 4)) / (this.speed - vx)
      this.extraX = Math.max(this.extraX, drift)
      return t + (TRUCK_LENGTH + drift) / this.speed
    }
    return t + TRUCK_LENGTH / this.speed
  }

  overpass(t: number, deckY: number): void {
    this.add('overpass', this.x(t), deckY)
  }

  /** Solid from y0 to top. Variant 0 hangs a sign from a gantry, 1 is a floodlight rig, 2 a roadside billboard. */
  gantry(t: number, y0: number, top: number, variant: number): void {
    this.add('gantry', this.x(t), y0, { a: top, variant })
  }

  crane(t: number, length: number, amplitude: number, phase: number): void {
    this.add('crane', this.x(t), 0, { a: length, b: amplitude, c: phase })
  }

  laser(t: number, y: number): void {
    this.add('laser', this.x(t), y)
  }

  interceptor(t: number): void {
    this.add('interceptor', this.x(t), 0, { variant: randomInt(this.s, 0, 1) })
  }

  drone(t: number, y: number, amplitude: number, phase = this.rand(0, Math.PI * 2), vx = -3): void {
    this.add('drone', this.x(t), y, { a: y, b: amplitude, c: phase, vx })
  }

  wall(t: number): number {
    this.add('wall', this.x(t), 0)
    return t + (WALL.radius + WALL.back) / this.speed
  }

  cell(t: number, y: number): void {
    this.s.cells.push({ x: this.x(t), y, taken: false })
  }

  cellLine(t0: number, t1: number, y0: number, y1: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1)
      this.cell(t0 + (t1 - t0) * f, y0 + (y1 - y0) * f)
    }
  }

  cellArc(t0: number, t1: number, yBase: number, yPeak: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1)
      this.cell(t0 + (t1 - t0) * f, yBase + (yPeak - yBase) * Math.sin(f * Math.PI))
    }
  }

  cellWave(t0: number, t1: number, yMid: number, amplitude: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1)
      this.cell(t0 + (t1 - t0) * f, yMid + amplitude * Math.sin(f * Math.PI * 2))
    }
  }

  end(t: number): void {
    this.endT = Math.max(this.endT, t)
  }

  get endX(): number {
    return this.x(this.endT) + this.extraX
  }
}

export type Pattern = {
  name: string
  /** Difficulty range in which the pattern can appear. */
  min: number
  max?: number
  weight: number
  build: (b: Builder) => void
}

export const PATTERNS: Pattern[] = [
  {
    name: 'cells',
    min: 0,
    weight: 0.5,
    build(b) {
      b.cellWave(0.2, 2.2, b.rand(3, 9), 2.5, 14)
      b.end(2.4)
    },
  },
  {
    name: 'parked-truck',
    min: 0,
    max: 0.8,
    weight: 1.3,
    build(b) {
      const end = b.truck(0.6)
      b.cellArc(0.25, end + 0.25, 2, 7.2, 9)
      b.end(end + 0.2)
    },
  },
  {
    name: 'convoy',
    min: 0.15,
    weight: 1,
    build(b) {
      const n = 2 + (b.d > 0.5 && b.chance(0.5) ? 1 : 0)
      const moving = b.chance(0.5)
      const gap = 1.2 - 0.4 * b.d
      let t = 0.5
      for (let i = 0; i < n; i++) {
        const end = b.truck(t, moving)
        b.cellLine(t, t + b.pass(TRUCK_LENGTH), 6.3, 6.3, 5)
        t = end + gap
      }
      b.end(t - gap + 0.2)
    },
  },
  {
    name: 'overpass',
    min: 0,
    weight: 1,
    build(b) {
      const low = b.chance(0.5)
      const deck = low ? b.rand(5, 5.8) : b.rand(8.2, 9.2)
      const center = 0.5 + b.pass(6)
      b.overpass(center, deck)
      if (low && b.chance(0.5)) b.cellLine(center - b.pass(6), center + b.pass(6), deck + 3.2, deck + 3.2, 5)
      else b.cellLine(center - b.pass(6), center + b.pass(6), 2.2, 2.2, 5)
      b.end(center + b.pass(6) + 0.3)
    },
  },
  {
    name: 'truck-under-overpass',
    min: 0.35,
    weight: 0.9,
    build(b) {
      const end = b.truck(0.6)
      const middle = 0.6 + b.pass(TRUCK_LENGTH / 2)
      b.overpass(middle, b.rand(8.5, 9.2))
      b.cellLine(0.6, end, 6.2, 6.2, 7)
      b.end(end + 0.2)
    },
  },
  {
    name: 'gantry',
    min: 0,
    weight: 1.2,
    build(b) {
      const t = 0.6
      const kind = randomInt(b.s, 0, 2)
      if (kind === 0) {
        const top = b.rand(5.5, 8.5)
        b.gantry(t, 0, top, 2)
        b.cellArc(t - 0.4, t + 0.4, top + 0.5, top + 2.2, 5)
      } else if (kind === 1) {
        const y0 = b.rand(4.5, 7)
        b.gantry(t, y0, 15, 0)
        b.cellLine(t - 0.3, t + 0.3, y0 - 2.3, y0 - 2.3, 4)
      } else {
        const y0 = b.rand(3.5, 6)
        b.gantry(t, y0, y0 + b.rand(3, 4), 1)
        b.cellLine(t - 0.3, t + 0.3, 1.8, 1.8, 4)
      }
      b.end(t + 0.4)
    },
  },
  {
    name: 'slalom',
    min: 0.3,
    weight: 1,
    build(b) {
      const n = 3 + (b.d > 0.6 ? 1 : 0)
      const spacing = 1.4 - 0.3 * b.d
      let high = b.chance(0.5)
      let t = 0.6
      for (let i = 0; i < n; i++) {
        if (high) {
          const y0 = b.rand(5.5, 6.5)
          b.gantry(t, y0, 15, 0)
          b.cellLine(t - 0.15, t + 0.15, y0 - 2.4, y0 - 2.4, 3)
        } else {
          const top = b.rand(6.5, 7.5)
          b.gantry(t, 0, top, 2)
          b.cellLine(t - 0.15, t + 0.15, top + 2, top + 2, 3)
        }
        high = !high
        t += spacing
      }
      b.end(t - spacing + 0.4)
    },
  },
  {
    name: 'crane',
    min: 0.2,
    weight: 0.9,
    build(b) {
      const n = b.d > 0.5 ? 2 : 1
      const maxLength = 15 + 3.5 * b.d
      let t = 0.7
      for (let i = 0; i < n; i++) {
        b.crane(t, b.rand(13, maxLength), 0.55, b.rand(0, Math.PI * 2))
        t += 1.3
      }
      b.cellLine(0.4, t - 1.3 + 0.4, 1.8, 1.8, 6)
      b.end(t - 1.3 + 0.5)
    },
  },
  {
    name: 'lasers',
    min: 0.2,
    weight: 0.9,
    build(b) {
      laserSet(b, 0.3, b.d < 0.5 ? 2 : 3)
      b.end(0.3 + 2.6)
    },
  },
  {
    name: 'laser-sweep',
    min: 0.5,
    weight: 0.7,
    build(b) {
      const first = laserSet(b, 0.3, 2)
      laserSet(b, 2.6, 3, first)
      b.end(2.6 + 2.6)
    },
  },
  {
    name: 'interceptor',
    min: 0.3,
    weight: 0.8,
    build(b) {
      const n = b.d > 0.6 ? 2 : 1
      for (let i = 0; i < n; i++) b.interceptor(0.2 + i * 1.2)
      b.cellWave(0.4, 0.4 + 1.2 * n, 6.5, 3, 6 * n)
      b.end(0.2 + (n - 1) * 1.2 + 2.7)
    },
  },
  {
    name: 'drones',
    min: 0.25,
    weight: 0.9,
    build(b) {
      const n = randomInt(b.s, 4, 6)
      for (let i = 0; i < n; i++) b.drone(0.6 + i * 0.55, b.rand(2, 11.5), 1.2)
      b.end(0.6 + (n - 1) * 0.55 + 0.4)
    },
  },
  {
    name: 'ramp-wall',
    min: 0.4,
    weight: 0.5,
    build(b) {
      const end = b.wall(1.1)
      b.cellArc(0.3, end + 0.2, 3, 12.6, 9)
      b.end(end + 0.5)
    },
  },
  {
    name: 'truck-drone',
    min: 0.5,
    weight: 0.7,
    build(b) {
      const end = b.truck(0.5)
      b.drone(0.5 + b.pass(TRUCK_LENGTH / 2), 8.8, 0.7, undefined, 0)
      b.cellLine(0.5, end, 5.3, 5.3, 6)
      b.end(end + 0.2)
    },
  },
  {
    name: 'gantry-interceptor',
    min: 0.65,
    weight: 0.6,
    build(b) {
      const y0 = b.rand(3.8, 5.5)
      b.gantry(0.9, y0, y0 + 3.5, 1)
      b.interceptor(0.2)
      b.end(0.2 + 2.7)
    },
  },
]

/** Fire beams on `count` lanes and leave one safe lane (different from `avoid`); returns it. */
function laserSet(b: Builder, t: number, count: number, avoid = -1): number {
  const lanes = LASER_LANES.map((_, i) => i)
  const options = avoid >= 0 ? lanes.filter((i) => i !== avoid && Math.abs(i - avoid) <= 2) : lanes
  const safe = pick(b.s, options)
  const others = lanes.filter((i) => i !== safe)
  // Keep the beams nearest the safe lane so it really is the only way through.
  others.sort((p, q) => Math.abs(p - safe) - Math.abs(q - safe))
  for (const i of others.slice(0, count)) b.laser(t, LASER_LANES[i])
  const live = t + 1.3
  b.cellLine(live, live + 0.9, LASER_LANES[safe], LASER_LANES[safe], 6)
  return safe
}

const OPENING = 'parked-truck'

/** Append the next pattern after s.spawnX. */
export function spawnPattern(s: SimState, only?: Pattern): string {
  const distance = s.spawnX - s.startX
  const d = difficultyAt(distance)
  const speed = speedAt(distance)
  let pattern = only ?? (s.lastPattern !== '' && s.onlyPattern ? PATTERNS.find((p) => p.name === s.onlyPattern) : undefined)
  if (!pattern) {
    const first = s.lastPattern === ''
    const pool = PATTERNS.filter(
      (p) => (first ? p.name === OPENING : p.name !== s.lastPattern && p.min <= d && (p.max ?? 1) >= d),
    )
    const total = pool.reduce((sum, p) => sum + p.weight, 0)
    let r = nextRandom(s) * total
    pattern = pool[pool.length - 1]
    for (const p of pool) {
      r -= p.weight
      if (r <= 0) {
        pattern = p
        break
      }
    }
  }
  const b = new Builder(s, s.spawnX, speed, d)
  pattern.build(b)
  s.spawnX = b.endX + (0.9 - 0.35 * d) * speed
  s.lastPattern = pattern.name
  return pattern.name
}

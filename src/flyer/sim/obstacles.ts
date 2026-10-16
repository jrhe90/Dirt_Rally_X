import {
  BALL_RADIUS,
  CRANE_PIVOT_Y,
  DRONE_RADIUS,
  GANTRY_HALF,
  INTERCEPTOR_HALF,
  INTERCEPTOR_LAUNCH_AHEAD,
  INTERCEPTOR_LOCK,
  INTERCEPTOR_RADIUS,
  INTERCEPTOR_SPEED,
  INTERCEPTOR_WARN,
  LASER_FIRE,
  LASER_WARN,
  OVERPASS_DECK,
  OVERPASS_HALF,
  STEP,
  TRUCK,
  TRUCK_WAKE_DISTANCE,
  WALL,
} from './config'
import type { Obstacle, SimState } from './types'

/**
 * Obstacle parameters by kind:
 * - truck: x = rear end, a = driving speed once the car gets close (0 = parked), variant = cargo colors
 * - overpass: x = center, y = deck underside
 * - gantry: x = center, y = bottom of the sign, a = top of the solid part; variant 0 sign, 1 floodlight rig, 2 roadside billboard
 * - crane: x = pivot, a = chain length, b = swing amplitude (rad), c = phase
 * - laser: x = trigger point, y = beam height
 * - interceptor: x = trigger point until launch, then its nose; y = height (tracks the car while warning)
 * - drone: x, a = base height, b = bob amplitude, c = phase; y is derived
 * - wall: x = foot of the quarter-pipe
 */

export const CRANE_FREQ = 1.7
export const DRONE_FREQ = 2.2
export const LASER_HALF_THICKNESS = 0.32

export type Capsule = { ax: number; ay: number; bx: number; by: number; r: number }

const SAMPLES = 9

function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

function pointBox(px: number, py: number, x0: number, x1: number, y0: number, y1: number): number {
  const dx = Math.max(x0 - px, 0, px - x1)
  const dy = Math.max(y0 - py, 0, py - y1)
  if (dx === 0 && dy === 0) return -Math.min(px - x0, x1 - px, py - y0, y1 - py)
  return Math.hypot(dx, dy)
}

function capsuleBox(c: Capsule, x0: number, x1: number, y0: number, y1: number): number {
  let best = Infinity
  for (let i = 0; i < SAMPLES; i++) {
    const f = i / (SAMPLES - 1)
    best = Math.min(best, pointBox(c.ax + (c.bx - c.ax) * f, c.ay + (c.by - c.ay) * f, x0, x1, y0, y1))
  }
  return best - c.r
}

function capsuleCircle(c: Capsule, x: number, y: number, r: number): number {
  return pointSegment(x, y, c.ax, c.ay, c.bx, c.by) - c.r - r
}

function capsuleSegment(c: Capsule, ax: number, ay: number, bx: number, by: number, r: number): number {
  let best = Infinity
  for (let i = 0; i < SAMPLES; i++) {
    const f = i / (SAMPLES - 1)
    best = Math.min(best, pointSegment(ax + (bx - ax) * f, ay + (by - ay) * f, c.ax, c.ay, c.bx, c.by))
  }
  for (const [px, py] of [[c.ax, c.ay], [c.bx, c.by]]) best = Math.min(best, pointSegment(px, py, ax, ay, bx, by))
  return best - c.r - r
}

/** Height of the quarter-pipe's surface at world x, or -1 outside it. */
export function wallHeight(o: Obstacle, x: number): number {
  const u = x - o.x
  if (u < 0 || u > WALL.radius + WALL.back) return -1
  if (u >= WALL.radius) return WALL.top
  return WALL.radius - Math.sqrt(WALL.radius * WALL.radius - u * u)
}

export function craneBall(o: Obstacle, t: number): { x: number; y: number; angle: number } {
  const angle = o.b * Math.sin(CRANE_FREQ * t + o.c)
  return { x: o.x + o.a * Math.sin(angle), y: CRANE_PIVOT_Y - o.a * Math.cos(angle), angle }
}

export function droneY(o: Obstacle, t: number): number {
  return o.a + o.b * Math.sin(DRONE_FREQ * t + o.c)
}

export function laserLive(o: Obstacle): boolean {
  return o.kind === 'laser' && o.state === 'active'
}

/** Signed clearance between the car capsule and an obstacle; <= 0 is a hit. */
export function obstacleDistance(o: Obstacle, c: Capsule, t: number): number {
  switch (o.kind) {
    case 'truck': {
      const trailer = capsuleBox(c, o.x, o.x + TRUCK.trailerLength, 0, TRUCK.trailerHeight)
      const cab = capsuleBox(c, o.x + TRUCK.trailerLength, o.x + TRUCK.trailerLength + TRUCK.cabLength, 0, TRUCK.cabHeight)
      return Math.min(trailer, cab)
    }
    case 'overpass':
      return capsuleBox(c, o.x - OVERPASS_HALF, o.x + OVERPASS_HALF, o.y, o.y + OVERPASS_DECK)
    case 'gantry':
      return capsuleBox(c, o.x - GANTRY_HALF, o.x + GANTRY_HALF, o.y, o.a)
    case 'crane': {
      const ball = craneBall(o, t)
      return Math.min(
        capsuleCircle(c, ball.x, ball.y, BALL_RADIUS),
        capsuleSegment(c, o.x, CRANE_PIVOT_Y, ball.x, ball.y, 0.12),
      )
    }
    case 'laser': {
      if (o.state !== 'active') return Infinity
      return Math.min(Math.abs(c.ay - o.y), Math.abs(c.by - o.y), (c.ay - o.y) * (c.by - o.y) <= 0 ? 0 : Infinity) - c.r - LASER_HALF_THICKNESS
    }
    case 'interceptor':
      if (o.state !== 'active') return Infinity
      return capsuleSegment(c, o.x, o.y, o.x + INTERCEPTOR_HALF * 2, o.y, INTERCEPTOR_RADIUS)
    case 'drone':
      return capsuleCircle(c, o.x, droneY(o, t), DRONE_RADIUS)
    case 'wall': {
      let best = Infinity
      const slices = 10
      for (let i = 0; i < slices; i++) {
        const xa = o.x + (WALL.radius * i) / slices
        const xb = o.x + (WALL.radius * (i + 1)) / slices
        best = Math.min(best, capsuleBox(c, xa, xb, 0, wallHeight(o, xb)))
      }
      return Math.min(best, capsuleBox(c, o.x + WALL.radius, o.x + WALL.radius + WALL.back, 0, WALL.top))
    }
  }
}

/** Advance moving obstacles and the laser / interceptor state machines; refresh x extents. */
export function updateObstacle(o: Obstacle, s: SimState): void {
  const car = s.car
  switch (o.kind) {
    case 'truck':
      if (o.vx === 0 && o.a > 0 && car.x > o.x - TRUCK_WAKE_DISTANCE) o.vx = o.a
      o.x += o.vx * STEP
      o.x0 = o.x
      o.x1 = o.x + TRUCK.trailerLength + TRUCK.cabLength
      break
    case 'overpass':
      o.x0 = o.x - OVERPASS_HALF
      o.x1 = o.x + OVERPASS_HALF
      break
    case 'gantry':
      o.x0 = o.x - GANTRY_HALF
      o.x1 = o.x + GANTRY_HALF
      break
    case 'crane':
      o.x0 = o.x - o.a * Math.sin(o.b) - 1.3
      o.x1 = o.x + o.a * Math.sin(o.b) + 1.3
      break
    case 'drone':
      o.x += o.vx * STEP
      o.y = droneY(o, s.t)
      o.x0 = o.x - DRONE_RADIUS
      o.x1 = o.x + DRONE_RADIUS
      break
    case 'wall':
      o.x0 = o.x
      o.x1 = o.x + WALL.radius + WALL.back
      break
    case 'laser':
      if (o.state === 'idle') {
        o.x0 = o.x1 = o.x
        if (s.phase === 'flying' && car.x >= o.x) {
          o.state = 'warn'
          o.stateT = 0
          s.events.push({ type: 'laserWarn', id: o.id })
        }
        break
      }
      o.stateT += STEP
      if (o.state === 'warn' && o.stateT >= LASER_WARN) {
        o.state = 'active'
        o.stateT = 0
        s.events.push({ type: 'laserFire', id: o.id })
      } else if (o.state === 'active' && o.stateT >= LASER_FIRE) {
        o.state = 'done'
        o.stateT = 0
      }
      // Beams span the whole screen while they are live, then stay where they ended.
      if (o.state !== 'done') {
        o.x0 = car.x - 60
        o.x1 = car.x + 60
      }
      break
    case 'interceptor':
      if (o.state === 'idle') {
        o.x0 = o.x1 = o.x
        if (s.phase === 'flying' && car.x >= o.x) {
          o.state = 'warn'
          o.stateT = 0
          o.y = car.y
          s.events.push({ type: 'interceptorWarn', id: o.id })
        }
        break
      }
      o.stateT += STEP
      if (o.state === 'warn') {
        if (o.stateT < INTERCEPTOR_WARN - INTERCEPTOR_LOCK) o.y += (car.y - o.y) * Math.min(1, STEP * 5)
        o.x0 = car.x - 60
        o.x1 = car.x + 60
        if (o.stateT >= INTERCEPTOR_WARN) {
          o.state = 'active'
          o.stateT = 0
          o.x = car.x + INTERCEPTOR_LAUNCH_AHEAD
          o.vx = -INTERCEPTOR_SPEED
          s.events.push({ type: 'interceptorLaunch', id: o.id })
        }
      } else if (o.state === 'active') {
        o.x += o.vx * STEP
        o.x0 = o.x
        o.x1 = o.x + INTERCEPTOR_HALF * 2
        if (o.x1 < car.x - 30) o.state = 'done'
      }
      break
  }
}

/** True once the obstacle can no longer touch the car. */
export function obstacleBehind(o: Obstacle, carX: number): boolean {
  if (o.kind === 'laser') return o.state === 'done'
  if (o.kind === 'interceptor') return o.state === 'done' || (o.state === 'active' && o.x1 < carX - 2.5)
  return o.x1 < carX - 2.5
}

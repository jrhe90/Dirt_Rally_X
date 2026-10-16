import {
  BOOST_FACTOR,
  BOOST_TIME,
  CAR_HALF,
  CAR_RADIUS,
  CEILING_Y,
  CELL_RADIUS,
  CLEAN_MAX_IMPACT,
  CLEAN_WINDOW,
  FLARE_ACCEL,
  FLARE_HEIGHT,
  FLARE_TARGET_VY,
  FLARE_TRIGGER_VY,
  GRAVITY,
  GROUND_Y,
  MAX_FALL,
  MAX_RISE,
  MIN_AIRTIME,
  NEAR_MISS,
  pitchFor,
  ROLL_MIN_HEIGHT,
  ROLL_SHIELD,
  ROLL_TIME,
  SPEED_MIN,
  speedAt,
  SPOOL_DOWN,
  SPOOL_UP,
  STEP,
  STYLE,
  THRUST,
} from './config'
import { obstacleBehind, obstacleDistance, updateObstacle, type Capsule } from './obstacles'
import { spawnPattern } from './patterns'
import { nextRandom } from './rng'
import { SOFT_KINDS, type Obstacle, type ObstacleKind, type SimInput, type SimState } from './types'

/** How far ahead of the car patterns are generated (plus two seconds of travel). */
const SPAWN_AHEAD = 110
const CLEANUP_BEHIND = 60
/** Calm stretch before the first pattern. */
const OPENING_SECONDS = 2.2

export function createSim(seed: number): SimState {
  return {
    t: 0,
    phase: 'ready',
    rng: seed | 0,
    car: {
      x: 0,
      y: GROUND_Y,
      vx: SPEED_MIN,
      vy: 0,
      spool: 0,
      hold: false,
      grounded: true,
      airTime: 0,
      sinceHold: 99,
      flare: false,
      pitch: 0,
      roll: 0,
      rollT: -1,
      rollsThisAir: 0,
      boostT: 0,
      crash: null,
    },
    startX: 0,
    obstacles: [],
    cells: [],
    nextId: 1,
    spawnX: 0,
    lastPattern: '',
    style: 0,
    cellsTaken: 0,
    cellChain: 0,
    lastCellT: -1,
    events: [],
  }
}

/** Leave the attract mode and start generating obstacles. */
export function startRun(s: SimState): void {
  s.phase = 'flying'
  s.startX = s.car.x
  s.spawnX = s.car.x + OPENING_SECONDS * SPEED_MIN
}

export function distanceOf(s: SimState): number {
  return Math.max(0, s.car.x - s.startX)
}

export function scoreOf(s: SimState): number {
  return Math.floor(distanceOf(s)) + s.style
}

export function carCapsule(x: number, y: number, pitch: number): Capsule {
  const cx = Math.cos(pitch) * CAR_HALF
  const cy = Math.sin(pitch) * CAR_HALF
  return { ax: x - cx, ay: y - cy, bx: x + cx, by: y + cy, r: CAR_RADIUS }
}

function easeInOut(f: number): number {
  return f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2
}

export function step(s: SimState, input: SimInput): void {
  s.t += STEP
  const car = s.car

  if (s.phase === 'crashed' || s.phase === 'over') {
    stepCrash(s)
    for (const o of s.obstacles) updateObstacle(o, s)
    return
  }

  const flying = s.phase === 'flying'
  const distance = distanceOf(s)
  if (car.boostT > 0) car.boostT -= STEP
  const target = (flying ? speedAt(distance) : SPEED_MIN) * (car.boostT > 0 ? BOOST_FACTOR : 1)
  car.vx += (target - car.vx) * Math.min(1, STEP * 3)

  const hold = flying && input.hold
  car.hold = hold
  car.sinceHold = hold ? 0 : car.sinceHold + STEP
  car.spool = hold ? Math.min(1, car.spool + SPOOL_UP * STEP) : Math.max(0, car.spool - SPOOL_DOWN * STEP)

  // Barrel roll: a full turn about the car's length. The jets turn with the body, so lift drops away.
  if (input.roll && flying && car.rollT < 0 && !car.grounded && car.y > GROUND_Y + ROLL_MIN_HEIGHT) {
    car.rollT = 0
    s.events.push({ type: 'rollStart' })
  }
  if (car.rollT >= 0) {
    car.rollT += STEP
    const f = Math.min(1, car.rollT / ROLL_TIME)
    car.roll = Math.PI * 2 * easeInOut(f)
    if (f >= 1) {
      car.rollT = -1
      car.roll = 0
      car.rollsThisAir++
      const points = STYLE.roll * car.rollsThisAir
      s.style += points
      s.events.push({ type: 'roll', count: car.rollsThisAir, points })
    }
  }
  const lift = Math.cos(car.roll)
  let ay = -GRAVITY + THRUST * car.spool * (lift >= 0 ? lift : lift * 0.5)

  // Automatic landing burn when dropping fast onto the road.
  const height = car.y - GROUND_Y
  if (hold || car.grounded || car.rollT >= 0) car.flare = false
  else if (car.vy < FLARE_TRIGGER_VY && height < FLARE_HEIGHT) car.flare = true
  if (car.flare) {
    if (car.vy < FLARE_TARGET_VY) ay += FLARE_ACCEL
    else car.flare = false
  }

  car.vy = Math.min(MAX_RISE, Math.max(-MAX_FALL, car.vy + ay * STEP))
  car.x += car.vx * STEP
  car.y += car.vy * STEP
  if (car.y > CEILING_Y) {
    car.y = CEILING_Y
    car.vy = Math.min(car.vy, 0)
  }

  if (car.y <= GROUND_Y) {
    const impact = -car.vy
    car.y = GROUND_Y
    car.vy = 0
    if (!car.grounded) {
      car.grounded = true
      if (car.rollT >= 0 && Math.cos(car.roll) < 0.85) {
        crash(s, 'ground')
        return
      }
      touchdown(s, impact)
    }
  } else if (car.grounded && car.y > GROUND_Y + 0.01) {
    s.events.push({ type: 'takeoff' })
    car.grounded = false
    car.airTime = 0
    car.rollsThisAir = 0
  }
  if (!car.grounded) car.airTime += STEP
  car.pitch = pitchFor(car.vy, car.grounded)

  if (flying) {
    collide(s)
    if (s.phase !== 'flying') return
    collectCells(s)
    while (s.spawnX < car.x + SPAWN_AHEAD + car.vx * 2) spawnPattern(s)
  }
  for (const o of s.obstacles) updateObstacle(o, s)
  cleanup(s)
}

function touchdown(s: SimState, impact: number): void {
  const car = s.car
  if (car.airTime < MIN_AIRTIME) return
  const clean = car.sinceHold < CLEAN_WINDOW && impact < CLEAN_MAX_IMPACT
  let points = 0
  if (clean && s.phase === 'flying') {
    points = STYLE.cleanLanding * (1 + car.rollsThisAir)
    s.style += points
    car.boostT = BOOST_TIME
  }
  s.events.push({ type: 'land', impact, clean, rolls: car.rollsThisAir, points })
  car.rollsThisAir = 0
}

function shielded(s: SimState): boolean {
  const t = s.car.rollT / ROLL_TIME
  return s.car.rollT >= 0 && t >= ROLL_SHIELD[0] && t <= ROLL_SHIELD[1]
}

function collide(s: SimState): void {
  const car = s.car
  const capsule = carCapsule(car.x, car.y, car.pitch)
  for (const o of s.obstacles) {
    if (o.passed) continue
    if (o.x1 < car.x - 8 || o.x0 > car.x + 8) {
      checkPassed(s, o)
      continue
    }
    const d = obstacleDistance(o, capsule, s.t)
    if (d <= 0) {
      if (SOFT_KINDS.has(o.kind) && shielded(s)) {
        if (!o.dodged) {
          o.dodged = true
          s.style += STYLE.rollDodge
          s.events.push({ type: 'rollDodge', kind: o.kind, points: STYLE.rollDodge })
        }
        continue
      }
      crash(s, o.kind)
      return
    }
    if (d < NEAR_MISS) o.near = true
    checkPassed(s, o)
  }
}

function checkPassed(s: SimState, o: Obstacle): void {
  if (o.passed || !obstacleBehind(o, s.car.x)) return
  o.passed = true
  if (o.near && !o.dodged) {
    s.style += STYLE.nearMiss
    s.events.push({ type: 'nearMiss', kind: o.kind, points: STYLE.nearMiss })
  }
}

function collectCells(s: SimState): void {
  const car = s.car
  const capsule = carCapsule(car.x, car.y, car.pitch)
  for (const cell of s.cells) {
    if (cell.taken || Math.abs(cell.x - car.x) > CAR_HALF + CELL_RADIUS + 0.6) continue
    const dx = capsule.bx - capsule.ax
    const dy = capsule.by - capsule.ay
    const f = Math.max(0, Math.min(1, ((cell.x - capsule.ax) * dx + (cell.y - capsule.ay) * dy) / (dx * dx + dy * dy)))
    if (Math.hypot(cell.x - (capsule.ax + dx * f), cell.y - (capsule.ay + dy * f)) > CELL_RADIUS) continue
    cell.taken = true
    s.cellsTaken++
    s.cellChain = s.t - s.lastCellT < 0.45 ? s.cellChain + 1 : 0
    s.lastCellT = s.t
    s.events.push({ type: 'cell', x: cell.x, y: cell.y, chain: s.cellChain })
  }
}

function crash(s: SimState, cause: ObstacleKind | 'ground'): void {
  const car = s.car
  s.phase = 'crashed'
  car.spool = 0
  car.hold = false
  car.flare = false
  car.rollT = -1
  car.boostT = 0
  const solid = cause === 'truck' || cause === 'wall' || cause === 'overpass' || cause === 'gantry'
  car.crash = {
    vx: car.vx * (solid ? 0.55 : 0.8),
    vy: Math.max(car.vy * 0.4, 0) + (car.grounded ? 5 : 6.5),
    spinPitch: solid ? 6 + nextRandom(s) * 3 : 3,
    spinRoll: (nextRandom(s) < 0.5 ? -1 : 1) * (5 + nextRandom(s) * 5),
    grounded: false,
    startX: car.x,
    cause,
  }
  car.grounded = false
  s.events.push({ type: 'crash', kind: cause })
}

/** Tumble, bounce and slide to a stop. */
function stepCrash(s: SimState): void {
  const car = s.car
  const c = car.crash
  if (!c) return
  c.vy -= GRAVITY * STEP
  car.x += c.vx * STEP
  car.y += c.vy * STEP
  car.pitch += c.spinPitch * STEP
  car.roll += c.spinRoll * STEP
  if (car.y <= GROUND_Y) {
    car.y = GROUND_Y
    if (c.vy < -3) {
      s.events.push({ type: 'bounce', impact: -c.vy })
      c.vy = -c.vy * 0.38
      c.spinPitch *= 0.55
      c.spinRoll *= 0.6
      c.vx *= 0.85
    } else {
      c.vy = 0
      c.grounded = true
    }
  }
  if (c.grounded) {
    c.vx = Math.max(0, c.vx - 10 * STEP)
    // Settle flat: either on the wheels or on the roof, whichever is closer.
    const rollTarget = Math.round(car.roll / Math.PI) * Math.PI
    car.roll += (rollTarget - car.roll) * Math.min(1, STEP * 6)
    const pitchTarget = Math.round(car.pitch / Math.PI) * Math.PI
    car.pitch += (pitchTarget - car.pitch) * Math.min(1, STEP * 6)
    c.spinPitch = 0
    c.spinRoll = 0
    if (c.vx < 0.3 && s.phase === 'crashed') {
      c.vx = 0
      s.phase = 'over'
      s.events.push({ type: 'over' })
    }
  }
  car.vx = c.vx
}

/** Drop what is far behind the car, compacting in place to avoid per-step garbage. */
function cleanup(s: SimState): void {
  const limit = s.car.x - CLEANUP_BEHIND
  let n = 0
  for (const o of s.obstacles) if (o.x1 >= limit || o.state === 'warn' || o.state === 'active') s.obstacles[n++] = o
  s.obstacles.length = n
  n = 0
  for (const c of s.cells) if (c.x >= limit) s.cells[n++] = c
  s.cells.length = n
}

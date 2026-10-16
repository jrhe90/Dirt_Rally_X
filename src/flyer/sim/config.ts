/**
 * Tuning for Thrust Runner. Units are meters and seconds. The run happens in a 2D plane:
 * x is distance along the road, y is height above it. The car's position is its body center.
 */

/** Fixed simulation step. 120 Hz keeps 60 Hz and 120 Hz screens smooth without interpolation. */
export const STEP = 1 / 120

/** Body-center height when the wheels are on the road. */
export const GROUND_Y = 0.62
/** Highest the car can climb. */
export const CEILING_Y = 13.6

export const GRAVITY = 33
export const THRUST = 80
export const MAX_RISE = 13
export const MAX_FALL = 23
/** Jet spool rate per second (0 → 1 in about 0.11 s). */
export const SPOOL_UP = 9
export const SPOOL_DOWN = 7

/** Falling faster than this near the road fires the jets automatically to cushion the landing. */
export const FLARE_TRIGGER_VY = -10
export const FLARE_HEIGHT = 2.8
export const FLARE_ACCEL = 58
export const FLARE_TARGET_VY = -5

/** Car hitbox: a capsule along the body, tilted with the pitch. */
export const CAR_HALF = 1.55
export const CAR_RADIUS = 0.55

/** Forward speed ramps from SPEED_MIN toward SPEED_MAX with distance. */
export const SPEED_MIN = 13
export const SPEED_MAX = 30
export const SPEED_RAMP = 1700
/** Distance at which pattern difficulty reaches 1. */
export const DIFFICULTY_RAMP = 3200

export const ROLL_TIME = 0.6
/** Part of the roll (as a fraction) that shields the car from lasers, drones and interceptors. */
export const ROLL_SHIELD: readonly [number, number] = [0.15, 0.75]
/** Minimum height above the road to start a roll. */
export const ROLL_MIN_HEIGHT = 1.2

/** A touchdown within this long of letting go of the jets counts as a feathered, clean landing. */
export const CLEAN_WINDOW = 0.35
export const CLEAN_MAX_IMPACT = 11
/** Airtime needed before a touchdown counts as a landing. */
export const MIN_AIRTIME = 0.4
export const BOOST_TIME = 1.2
export const BOOST_FACTOR = 1.18

export const NEAR_MISS = 1.0
export const CELL_RADIUS = 1.25

export const STYLE = {
  nearMiss: 25,
  roll: 100,
  rollDodge: 150,
  cleanLanding: 50,
} as const

/** Laser speed traps: warning time, then firing time. */
export const LASER_WARN = 1.3
export const LASER_FIRE = 1.0
/** Interceptors track your height while warning, then lock and launch. */
export const INTERCEPTOR_WARN = 1.25
export const INTERCEPTOR_LOCK = 0.3
export const INTERCEPTOR_SPEED = 38
export const INTERCEPTOR_LAUNCH_AHEAD = 70

/** Wrecking-ball pivot height (above the visible play area). */
export const CRANE_PIVOT_Y = 21

/** Car-carrier truck dimensions (x from its rear end). */
export const TRUCK = {
  trailerLength: 12.6,
  trailerHeight: 3.9,
  cabLength: 4.2,
  cabHeight: 4.4,
} as const

/** Moving trucks start driving once the car is this close to their rear. */
export const TRUCK_WAKE_DISTANCE = 50

export const OVERPASS_HALF = 6
export const OVERPASS_DECK = 1.8
export const GANTRY_HALF = 0.45
export const GANTRY_TRUSS = 0.8
export const WALL = { radius: 10, top: 10.4, back: 2.5 } as const
export const DRONE_RADIUS = 0.85
export const BALL_RADIUS = 1.25
export const INTERCEPTOR_HALF = 1.6
export const INTERCEPTOR_RADIUS = 0.6

export function speedAt(distance: number): number {
  return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * (1 - Math.exp(-Math.max(0, distance) / SPEED_RAMP))
}

export function difficultyAt(distance: number): number {
  return Math.min(1, Math.max(0, distance / DIFFICULTY_RAMP))
}

/** Nose up while climbing, slightly down while falling. Shared by the hitbox and the model. */
export function pitchFor(vy: number, grounded: boolean): number {
  if (grounded) return 0
  return Math.min(0.36, Math.max(-0.28, vy * 0.03))
}

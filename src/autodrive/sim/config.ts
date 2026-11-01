/**
 * Units are SI (m, s, m/s). The road is a divided highway with three lanes each way. Frenet
 * coordinates: `s` runs along the road, `d` is the lateral offset from the median, positive to
 * the left. We drive on the right, so our lanes have negative `d`; oncoming lanes are mirrored.
 */

export const STEP = 1 / 120

export const LANE_WIDTH = 3.7
export const LANES = 3
/** Half-width of the median: concrete barrier plus a narrow inner shoulder. */
export const MEDIAN_HALF = 1.0
export const BARRIER_HALF = 0.3
export const SHOULDER = 3.0
/** Outer edge of the paved shoulder (our side), where the guard rail stands. */
export const ROAD_EDGE = MEDIAN_HALF + LANES * LANE_WIDTH + SHOULDER

/** Lane 0 is the fast lane next to the median, lane 2 the slow lane. Lane 3 is the shoulder. */
export function laneCenter(lane: number): number {
  if (lane >= LANES) return -(MEDIAN_HALF + LANES * LANE_WIDTH + SHOULDER * 0.5)
  return -(MEDIAN_HALF + LANE_WIDTH * (lane + 0.5))
}

export function laneOf(d: number): number {
  const x = (-d - MEDIAN_HALF) / LANE_WIDTH
  return Math.max(0, Math.min(LANES, Math.floor(x)))
}

export const oncomingLaneCenter = (lane: number): number => -laneCenter(lane)

export const SPEED_LIMIT = 110 / 3.6
export const kmh = (v: number): number => v * 3.6

export const GRAVITY = 9.81

/** The hero car: a dual-motor electric fastback. */
export const EGO = {
  length: 4.97,
  width: 1.96,
  wheelbase: 2.96,
  mass: 2100,
  grip: 1.08,
  power: 500_000,
  maxAccel: 9.6,
  maxBrake: 10.5,
  topSpeed: 250 / 3.6,
  maxReverse: 9,
  /** Aero drag and rolling resistance as decelerations: k·v² and c. */
  drag: 0.00014 * 2.2,
  rolling: 0.12,
  maxSteer: 0.6,
  steerRate: 1.6,
} as const

export const PHYS = {
  restitution: 0.25,
  /** Damage per m/s of impact speed change. */
  damagePerImpact: 0.018,
  wreckImpact: 11,
} as const

export const TRAFFIC = {
  ahead: 560,
  behind: 220,
  despawnAhead: 760,
  despawnBehind: 300,
  /** Cars per km per lane. */
  densityMin: 7,
  densityMax: 13,
  oncomingDensity: 9,
} as const

export const POLICE = {
  speedTrapMargin: 20 / 3.6,
  pursuitMargin: 14 / 3.6,
  bustSpeed: 9,
  bustRadius: 11,
  bustRate: 0.42,
  escapeDistance: 330,
  escapeTime: 9,
  heatPerMinute: 1.1,
  maxHeat: 5,
} as const

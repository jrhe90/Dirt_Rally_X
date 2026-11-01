import { EGO, SPEED_LIMIT } from '../config'

/**
 * Driving profiles, from relaxed to "get me out of here". They set the cruise speed relative
 * to the limit, following distance, how hard the car accelerates and corners, how eager it is
 * to change lanes to pass, and how much room it leaves around other vehicles.
 */
export type ProfileName = 'chill' | 'standard' | 'hurry' | 'pursuit'

export type Profile = {
  name: ProfileName
  label: string
  /** Default cruise speed, m/s. */
  cruise: number
  /** Time gap to the car ahead, s. */
  headway: number
  minGap: number
  accel: number
  decel: number
  latAccel: number
  laneChangeTime: number
  /** Seconds of indicating before a discretionary lane change starts. */
  laneChangePrep: number
  /** Speed advantage (m/s) a lane must offer before changing into it to pass. */
  passGain: number
  /** Seconds between discretionary lane changes. */
  cooldown: number
  marginS: number
  marginD: number
  /** Willing to use the hard shoulder. */
  shoulder: boolean
  /** Weight for keeping out of the passing lane when not passing. */
  keepRight: number
  /** Weight for keeping away from police. */
  copAvoid: number
  /** Comfort weighting on jerk. */
  smooth: number
}

export const PROFILES: Record<ProfileName, Profile> = {
  chill: {
    name: 'chill',
    label: 'CHILL',
    cruise: SPEED_LIMIT,
    headway: 2.1,
    minGap: 5,
    accel: 1.7,
    decel: 2.6,
    latAccel: 2.3,
    laneChangeTime: 4.6,
    laneChangePrep: 1.3,
    passGain: 4,
    cooldown: 9,
    marginS: 2.4,
    marginD: 0.55,
    shoulder: false,
    keepRight: 1.2,
    copAvoid: 0.5,
    smooth: 2.2,
  },
  standard: {
    name: 'standard',
    label: 'STANDARD',
    cruise: SPEED_LIMIT * 1.1,
    headway: 1.55,
    minGap: 4,
    accel: 2.6,
    decel: 3.4,
    latAccel: 3.3,
    laneChangeTime: 3.7,
    laneChangePrep: 0.9,
    passGain: 2.4,
    cooldown: 5,
    marginS: 2.0,
    marginD: 0.45,
    shoulder: false,
    keepRight: 1.0,
    copAvoid: 1,
    smooth: 1.4,
  },
  hurry: {
    name: 'hurry',
    label: 'HURRY',
    cruise: SPEED_LIMIT * 1.36,
    headway: 1.05,
    minGap: 3,
    accel: 4.4,
    decel: 4.8,
    latAccel: 5.0,
    laneChangeTime: 2.8,
    laneChangePrep: 0.5,
    passGain: 1.1,
    cooldown: 2.6,
    marginS: 1.6,
    marginD: 0.35,
    shoulder: false,
    keepRight: 0.5,
    copAvoid: 2,
    smooth: 0.8,
  },
  pursuit: {
    name: 'pursuit',
    label: 'PURSUIT',
    cruise: EGO.topSpeed,
    headway: 0.62,
    minGap: 2.4,
    accel: EGO.maxAccel,
    decel: 7.5,
    latAccel: 7.6,
    laneChangeTime: 1.9,
    laneChangePrep: 0.12,
    passGain: 0.4,
    cooldown: 0.9,
    marginS: 1.15,
    marginD: 0.26,
    shoulder: true,
    keepRight: 0,
    copAvoid: 4,
    smooth: 0.35,
  },
}

export const PROFILE_ORDER: ProfileName[] = ['chill', 'standard', 'hurry', 'pursuit']

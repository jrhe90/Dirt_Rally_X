import { BODY_STYLES, setBodyStyle, type BodyStyle } from './carShape'
import { CAR } from './config'

/** Paint scheme and decals painted onto the body. */
export type LiveryScheme = {
  /** Main body paint. */
  base: string
  /** Lower body and bumpers. */
  lower: string
  /** Side wedge, bonnet chevron and roof accents. */
  primary: string
  /** Roof panel and the wedge's darker edge. */
  deep: string
  /** Pinstripes and small shards. */
  stripe: string
  shard: string
  /** Text drawn on the base paint. */
  ink: string
  brand: string
  sponsor: string
  number: string
  crew: string
}

type CarTuning = Partial<Omit<typeof CAR, 'torqueCurve' | 'gears'>> & {
  torqueCurve?: [number, number][]
  gears?: number[]
}

export type CarSpec = {
  id: string
  name: string
  /** Short class label shown on the picker, e.g. "AWD · 1250 kg". */
  tagline: string
  description: string
  body: BodyStyle['kind']
  tuning: CarTuning
  livery: LiveryScheme
}

const BASE = structuredClone(CAR)

export const CARS: CarSpec[] = [
  {
    id: 'kestrel',
    name: 'Kestrel R5',
    tagline: 'AWD · 1250 kg · 300 hp',
    description: 'Modern four-wheel-drive rally car. Planted, quick and forgiving.',
    body: 'hatch',
    tuning: {},
    livery: {
      base: '#f2f2ef',
      lower: '#121315',
      primary: '#1b56f0',
      deep: '#0b2a8a',
      stripe: '#e4ff1c',
      shard: '#14d8c4',
      ink: '#121315',
      brand: 'KESTREL',
      sponsor: 'VOLTA ENERGY',
      number: '27',
      crew: 'J. ROSS  ·  M. HALE',
    },
  },
  {
    id: 'vortex',
    name: 'Vortex S4',
    tagline: 'AWD · 1150 kg · 480 hp',
    description: 'Group B monster. Huge turbo power, rear-biased and twitchy over crests.',
    body: 'hatch',
    tuning: {
      mass: 1150,
      inertia: { x: 1750, y: 2000, z: 500 },
      antiRollRear: 8000,
      redline: 8000,
      upshiftRpm: 7600,
      downshiftRpm: 3800,
      launchRpm: 4000,
      gears: [3.1, 2.15, 1.62, 1.28, 1.05, 0.88],
      finalDrive: 5.1,
      rearTorqueSplit: 0.62,
      torqueCurve: [
        [1000, 160],
        [2500, 240],
        [3500, 440],
        [5000, 530],
        [7000, 450],
        [8000, 380],
      ],
      brakeFront: 4200,
      brakeRear: 2700,
      downforce: 0.7,
    },
    livery: {
      base: '#f4f1ea',
      lower: '#141414',
      primary: '#d4141c',
      deep: '#7a0a10',
      stripe: '#f2c230',
      shard: '#f2c230',
      ink: '#141414',
      brand: 'VORTEX',
      sponsor: 'MARLO OIL',
      number: '4',
      crew: 'K. LAINE  ·  P. ORSI',
    },
  },
  {
    id: 'falco',
    name: 'Falco 131',
    tagline: 'RWD · 1050 kg · 230 hp',
    description: 'Classic rear-drive saloon. Less grip, more sideways — steer with the throttle.',
    body: 'hatch',
    tuning: {
      mass: 1050,
      // Rear-biased weight keeps the driven axle loaded so part throttle slides rather than spins.
      centerOfMass: { x: 0, y: -0.16, z: -0.08 },
      inertia: { x: 1600, y: 2000, z: 460 },
      springRate: 33000,
      damperBump: 2300,
      damperRebound: 3000,
      antiRollFront: 16000,
      antiRollRear: 6500,
      redline: 7800,
      upshiftRpm: 7400,
      downshiftRpm: 3600,
      launchRpm: 3600,
      gears: [3.4, 2.3, 1.7, 1.3, 1.02],
      finalDrive: 5.0,
      rearTorqueSplit: 1,
      torqueCurve: [
        [1000, 140],
        [3000, 200],
        [5000, 245],
        [6500, 250],
        [7800, 205],
      ],
      brakeFront: 3800,
      brakeRear: 2500,
      countersteerAssist: 0.7,
      drag: 0.46,
      downforce: 0.3,
    },
    livery: {
      base: '#2f6f3a',
      lower: '#e9e4d4',
      primary: '#f2c12e',
      deep: '#1d4a26',
      stripe: '#f4f1ea',
      shard: '#4fb3e8',
      ink: '#f4f1ea',
      brand: 'FALCO',
      sponsor: 'ALBA TOURS',
      number: '1',
      crew: 'R. BALDI  ·  E. HOLM',
    },
  },
  {
    id: 'mistral',
    name: 'Mistral Kit Car',
    tagline: 'FWD · 1000 kg · 260 hp',
    description: 'Light front-drive screamer. Brakes late, pulls hard, needs the handbrake to turn in.',
    body: 'hatch',
    tuning: {
      mass: 1000,
      inertia: { x: 1450, y: 1700, z: 420 },
      centerOfMass: { x: 0, y: -0.14, z: 0.2 },
      springRate: 34000,
      antiRollFront: 11000,
      antiRollRear: 12000,
      idleRpm: 1200,
      redline: 8800,
      upshiftRpm: 8400,
      downshiftRpm: 4600,
      launchRpm: 4200,
      gears: [3.0, 2.1, 1.6, 1.28, 1.05, 0.9],
      finalDrive: 5.6,
      rearTorqueSplit: 0,
      torqueCurve: [
        [1200, 150],
        [3500, 200],
        [5500, 245],
        [7500, 250],
        [8800, 215],
      ],
      brakeFront: 4300,
      brakeRear: 2300,
      handbrakeGrip: 0.8,
      countersteerAssist: 0.5,
    },
    livery: {
      base: '#ff6a1a',
      lower: '#1b1b1f',
      primary: '#1b1b1f',
      deep: '#1b1b1f',
      stripe: '#f4f1ea',
      shard: '#f4f1ea',
      ink: '#1b1b1f',
      brand: 'MISTRAL',
      sponsor: 'NORDWIND',
      number: '12',
      crew: 'A. VIDAL  ·  C. ROUX',
    },
  },
  {
    id: 'halden',
    name: 'Halden 9R Coupé',
    tagline: 'RWD · rear engine · 1100 kg · 300 hp',
    description: 'Rear-engined sports coupé. Huge traction out of corners; the tail swings like a pendulum if you lift mid-turn.',
    body: 'coupe',
    tuning: {
      mass: 1100,
      // Flat-six hung behind the rear axle.
      centerOfMass: { x: 0, y: -0.17, z: -0.3 },
      inertia: { x: 1650, y: 2050, z: 470 },
      springRate: 36000,
      antiRollFront: 16000,
      antiRollRear: 6500,
      redline: 8000,
      upshiftRpm: 7600,
      downshiftRpm: 3800,
      launchRpm: 3800,
      gears: [3.2, 2.1, 1.56, 1.23, 1.0, 0.84],
      finalDrive: 5.4,
      rearTorqueSplit: 1,
      torqueCurve: [
        [1000, 170],
        [3000, 270],
        [5000, 320],
        [6500, 335],
        [8000, 285],
      ],
      brakeFront: 3900,
      brakeRear: 3200,
      countersteerAssist: 0.65,
      downforce: 0.5,
    },
    livery: {
      base: '#c9ccd0',
      lower: '#1a1b1e',
      primary: '#123a7a',
      deep: '#0b2350',
      stripe: '#d3202b',
      shard: '#d3202b',
      ink: '#123a7a',
      brand: 'HALDEN',
      sponsor: 'NORDSEE',
      number: '9',
      crew: 'L. BRANDT  ·  T. VOSS',
    },
  },
  {
    id: 'terrax',
    name: 'Terrax 4x4',
    tagline: 'AWD 50:50 · 2150 kg · 420 hp V8',
    description: 'Boxy off-roader with a big V8. Heavy and tall, so brake early, but it shrugs off ruts and jumps.',
    body: 'suv',
    tuning: {
      mass: 2150,
      // Tall body and ladder frame: a higher center of mass and much more inertia.
      centerOfMass: { x: 0, y: -0.06, z: 0 },
      inertia: { x: 3400, y: 3900, z: 1100 },
      cabin: { halfExtents: { x: 0.8, y: 0.34, z: 1.1 }, center: { x: 0, y: 0.76, z: -0.7 } },
      // Spring and damper rates scaled to the weight so it sits at the same ride height.
      springRate: 64000,
      damperBump: 4300,
      damperRebound: 5600,
      bumpStopRate: 450000,
      antiRollFront: 26000,
      antiRollRear: 18000,
      steerRate: 3.4,
      idleRpm: 800,
      redline: 6400,
      upshiftRpm: 6000,
      downshiftRpm: 2600,
      launchRpm: 2600,
      gears: [3.6, 2.4, 1.7, 1.3, 1.0, 0.82],
      finalDrive: 4.6,
      rearTorqueSplit: 0.5,
      engineBrakeTorque: 50,
      torqueCurve: [
        [800, 330],
        [2000, 560],
        [3500, 630],
        [5000, 600],
        [6400, 470],
      ],
      brakeFront: 7400,
      brakeRear: 4900,
      handbrakeForce: 9500,
      drag: 0.62,
      downforce: 0,
    },
    livery: {
      base: '#d6ccb0',
      lower: '#2a2c26',
      primary: '#55653a',
      deep: '#3a4628',
      stripe: '#e07a1f',
      shard: '#e07a1f',
      ink: '#2a2c26',
      brand: 'TERRAX',
      sponsor: 'HOCHLAND',
      number: '44',
      crew: 'O. KELLER  ·  N. ARNDT',
    },
  },
]

export const DEFAULT_CAR = CARS[0]

let current = DEFAULT_CAR

export function carById(id: string | null | undefined): CarSpec | undefined {
  return CARS.find((c) => c.id === id)
}

export function currentCar(): CarSpec {
  return current
}

/** Loads a car's numbers into the shared `CAR` config; callers then refresh physics and visuals. */
export function selectCar(spec: CarSpec): void {
  current = spec
  setBodyStyle(BODY_STYLES[spec.body])
  Object.assign(CAR, structuredClone(BASE), structuredClone(spec.tuning))
}

export function nextCar(spec: CarSpec): CarSpec {
  return CARS[(CARS.indexOf(spec) + 1) % CARS.length]
}

const STORAGE_KEY = 'dirt-rally-car'

/** URL `?car=` wins, then the last car picked on this device. */
export function loadCarChoice(params: URLSearchParams): CarSpec {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage can be blocked; fall back to the default car.
  }
  return carById(params.get('car')) ?? carById(stored) ?? DEFAULT_CAR
}

export function saveCarChoice(spec: CarSpec): void {
  try {
    localStorage.setItem(STORAGE_KEY, spec.id)
  } catch {
    // Not remembered across visits, which is fine.
  }
}

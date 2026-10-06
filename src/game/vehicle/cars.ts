import { CAR } from './config'

/** Paint scheme and decals for the shared hatchback body. */
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

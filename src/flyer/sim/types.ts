export type Phase = 'ready' | 'flying' | 'crashed' | 'over'

export type ObstacleKind = 'truck' | 'overpass' | 'gantry' | 'crane' | 'laser' | 'interceptor' | 'drone' | 'wall'

/** Lasers, drones and interceptors can be dodged by rolling; solid structures cannot. */
export const SOFT_KINDS: ReadonlySet<ObstacleKind> = new Set(['laser', 'drone', 'interceptor'])

export type Obstacle = {
  id: number
  kind: ObstacleKind
  /** Anchor: truck rear, overpass/gantry/crane center, wall start, laser/interceptor trigger point. */
  x: number
  y: number
  /** Own forward speed (trucks drive, drones drift back, interceptors fly at you). */
  vx: number
  /** Kind-specific parameters (see obstacles.ts). */
  a: number
  b: number
  c: number
  variant: number
  /** idle → warn → active → done, for lasers and interceptors. */
  state: 'idle' | 'warn' | 'active' | 'done'
  stateT: number
  /** World x extent, refreshed every step. */
  x0: number
  x1: number
  near: boolean
  dodged: boolean
  passed: boolean
}

export type Cell = { x: number; y: number; taken: boolean }

export type CrashState = {
  vx: number
  vy: number
  spinPitch: number
  spinRoll: number
  grounded: boolean
  startX: number
  cause: ObstacleKind | 'ground'
}

export type Car = {
  x: number
  y: number
  vx: number
  vy: number
  /** Jet output 0–1. */
  spool: number
  hold: boolean
  grounded: boolean
  airTime: number
  sinceHold: number
  /** Automatic landing burn is firing. */
  flare: boolean
  pitch: number
  roll: number
  /** Seconds into the current roll, or -1. */
  rollT: number
  rollsThisAir: number
  boostT: number
  crash: CrashState | null
}

export type SimEvent =
  | { type: 'takeoff' }
  | { type: 'land'; impact: number; clean: boolean; rolls: number; points: number }
  | { type: 'rollStart' }
  | { type: 'roll'; count: number; points: number }
  | { type: 'rollDodge'; kind: ObstacleKind; points: number }
  | { type: 'nearMiss'; kind: ObstacleKind; points: number }
  | { type: 'cell'; x: number; y: number; chain: number }
  | { type: 'crash'; kind: ObstacleKind | 'ground' }
  | { type: 'bounce'; impact: number }
  | { type: 'over' }
  | { type: 'laserWarn'; id: number }
  | { type: 'laserFire'; id: number }
  | { type: 'interceptorWarn'; id: number }
  | { type: 'interceptorLaunch'; id: number }

export type SimInput = { hold: boolean; roll: boolean }

export type SimState = {
  t: number
  phase: Phase
  rng: number
  car: Car
  startX: number
  obstacles: Obstacle[]
  cells: Cell[]
  nextId: number
  /** World x where the next pattern starts. */
  spawnX: number
  lastPattern: string
  /** Debug: always spawn this pattern (after the opening one). */
  onlyPattern?: string
  style: number
  cellsTaken: number
  cellChain: number
  lastCellT: number
  events: SimEvent[]
}

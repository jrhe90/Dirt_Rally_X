import type { Road } from './road'

export type BodyKind = 'sedan' | 'hatch' | 'suv' | 'van' | 'truck' | 'sports' | 'cop' | 'ego'

/** Anything with a footprint on the road, in Frenet coordinates. `psi` is the heading relative to the road. */
export type Body = {
  id: number
  s: number
  d: number
  v: number
  psi: number
  length: number
  width: number
}

export type Role = 'traffic' | 'oncoming' | 'cop' | 'block'

export type CopState = 'patrol' | 'chase' | 'flank' | 'ram' | 'parked' | 'retreat'

export type Agent = Body & {
  role: Role
  kind: BodyKind
  height: number
  /** +1 with the flow, -1 for oncoming. */
  dir: 1 | -1
  vd: number
  accel: number
  lane: number
  targetLane: number
  desiredV: number
  /** Turn signal: +1 left, -1 right. */
  signal: number
  laneTimer: number
  /** Accepts small gaps and brakes others hard when changing lanes. */
  aggressive: boolean
  /** Seconds since it was wrecked, or -1. */
  wrecked: number
  spin: number
  color: number
  // Police only.
  copState: CopState
  health: number
  /** Lateral target used while flanking or ramming. */
  copTargetD: number
  stateTimer: number
}

export type Ego = Body & {
  steer: number
  accel: number
  yawRate: number
  latAccel: number
  /** 0..1 how hard the tyres are working past their limit (for smoke and screech). */
  slip: number
  damage: number
  tiresBlown: boolean
  odometer: number
  /** Braking lights. */
  braking: boolean
  signal: number
}

export type SpikeStrip = { id: number; s: number; d0: number; d1: number; hit: boolean; passed: boolean; age: number }

export type SpeedCam = { s: number; d: number; flashed: boolean }

export type DriveCommand = {
  /** Requested acceleration, m/s² (negative brakes). */
  accel: number
  /** Requested front-wheel angle, rad, positive left. */
  steer: number
  /** Allow reversing when stopped. */
  reverse?: boolean
  signal?: number
}

export type SimEvent =
  | { type: 'collision'; id: number; impact: number; role: Role }
  | { type: 'barrier'; impact: number; side: 1 | -1 }
  | { type: 'nearMiss'; id: number; speed: number }
  | { type: 'speedcam'; kmh: number }
  | { type: 'pursuit' }
  | { type: 'heat'; level: number }
  | { type: 'copWrecked'; id: number }
  | { type: 'spikesDropped'; id: number }
  | { type: 'spiked' }
  | { type: 'spikesDodged' }
  | { type: 'roadblock' }
  | { type: 'roadblockPassed' }
  | { type: 'escaped'; heat: number }
  | { type: 'busted' }
  | { type: 'wrecked' }
  | { type: 'bounty'; amount: number; label: string }
  | { type: 'agentCrash'; id: number; impact: number }

export type Mode = 'pursuit' | 'cruise'
export type Phase = 'drive' | 'busted' | 'wrecked'

export type Roadblock = { s: number; gapLane: number; passed: boolean }

export type SimState = {
  t: number
  rng: number
  seed: number
  mode: Mode
  phase: Phase
  road: Road
  ego: Ego
  agents: Agent[]
  spikes: SpikeStrip[]
  cams: SpeedCam[]
  roadblocks: Roadblock[]
  events: SimEvent[]
  nextId: number
  /** 0..5; the integer part is the heat level. */
  heat: number
  pursuit: boolean
  /** 0..1, busted at 1. */
  bust: number
  /** Seconds spent out of the cops' reach, counting toward an escape. */
  cooldown: number
  bounty: number
  /** Distance driven with the autopilot engaged since the last intervention. */
  cleanDistance: number
  stats: { collisions: number; nearMisses: number; escapes: number; takedowns: number; maxSpeed: number; interventions: number }
  /** Next s for spawning features. */
  nextCam: number
  nextPatrol: number
  nextSpikes: number
  nextRoadblock: number
  /** Set by the autopilot each step, read by the bounty logic. */
  autopilot: boolean
}

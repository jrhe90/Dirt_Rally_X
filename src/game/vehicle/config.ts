import type { Surface } from '../track'

export const CAR = {
  mass: 1250,
  halfExtents: { x: 0.85, y: 0.28, z: 2.0 },
  /** Second collider for the glasshouse, so the roof touches the ground in a rollover. */
  cabin: { halfExtents: { x: 0.68, y: 0.22, z: 0.85 }, center: { x: 0, y: 0.48, z: -0.2 } },
  centerOfMass: { x: 0, y: -0.14, z: 0.05 },
  inertia: { x: 1800, y: 2100, z: 520 },

  wheelRadius: 0.34,
  restLength: 0.32,
  mountY: -0.05,
  halfTrack: 0.78,
  frontAxle: 1.27,
  rearAxle: -1.22,

  springRate: 38000,
  damperBump: 2600,
  damperRebound: 3400,
  bumpStopRate: 300000,
  antiRollFront: 14000,
  antiRollRear: 9000,

  maxSteer: 0.58,
  highSpeedSteer: 0.2,
  steerRate: 4,
  countersteerAssist: 0.55,

  idleRpm: 1000,
  redline: 7600,
  upshiftRpm: 7100,
  downshiftRpm: 3300,
  launchRpm: 3200,
  shiftTime: 0.16,
  gears: [3.3, 2.25, 1.68, 1.32, 1.08, 0.9],
  reverseRatio: 3.2,
  finalDrive: 5.3,
  drivetrainEfficiency: 0.85,
  rearTorqueSplit: 0.6,
  engineBrakeTorque: 30,
  /** [rpm, Nm] */
  torqueCurve: [
    [1000, 200],
    [2500, 330],
    [4000, 420],
    [5500, 410],
    [7000, 340],
    [7600, 300],
  ] as [number, number][],

  brakeFront: 4400,
  brakeRear: 2900,
  handbrakeGrip: 0.9,
  /**
   * Most braking force the handbrake can hold per rear wheel (N at the contact patch). Below this the
   * wheel locks and slides; under a landing's load spike the tyre out-grips it and keeps rolling.
   */
  handbrakeForce: 5000,

  drag: 0.42,
  downforce: 0.8,
  airStabilization: 1.2,
}

export type SurfaceGrip = {
  /** Peak friction coefficient. */
  grip: number
  /** Friction once the tyre is sliding. */
  slide: number
  rolling: number
  dust: number
}

export const SURFACES: Record<Surface, SurfaceGrip> = {
  gravel: { grip: 0.95, slide: 0.78, rolling: 0.02, dust: 1 },
  tarmac: { grip: 1.18, slide: 0.98, rolling: 0.012, dust: 0.08 },
  grass: { grip: 0.78, slide: 0.62, rolling: 0.045, dust: 0.45 },
}

export function torqueAt(rpm: number): number {
  const curve = CAR.torqueCurve
  if (rpm <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1]
      const [r1, t1] = curve[i]
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0)
    }
  }
  return curve[curve.length - 1][1]
}

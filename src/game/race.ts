import * as THREE from 'three'
import type { Track } from './track'

export const LAPS = 3
const START_OFFSET = 12
const RIDE_HEIGHT = 0.95

export type Pose = { position: THREE.Vector3; yaw: number }

export class Race {
  progress = -START_OFFSET
  lap = 1
  finished = false
  time = 0
  trackIndex = 0
  lateral = 0
  /** Completed lap times in seconds. */
  readonly lapTimes: number[] = []

  private lastDistance = 0
  private readonly track: Track

  constructor(track: Track) {
    this.track = track
    this.reset()
  }

  reset(): void {
    this.progress = -START_OFFSET
    this.lap = 1
    this.finished = false
    this.time = 0
    this.lapTimes.length = 0
    this.lastDistance = this.track.length - START_OFFSET
    this.trackIndex = this.track.pointAt(this.lastDistance).index
  }

  startPose(): Pose {
    return this.poseAt(this.track.length - START_OFFSET)
  }

  /** Back on the road at the nearest point, facing the direction of travel. */
  recoveryPose(position: THREE.Vector3): Pose {
    const proj = this.track.project(position.x, position.z, this.trackIndex)
    return this.poseAt(proj.distance)
  }

  private poseAt(distance: number): Pose {
    const { position, tangent } = this.track.pointAt(distance)
    return {
      position: position.clone().setY(position.y + RIDE_HEIGHT),
      yaw: Math.atan2(tangent.x, tangent.z),
    }
  }

  update(dt: number, position: THREE.Vector3, running: boolean): void {
    const proj = this.track.project(position.x, position.z, this.trackIndex)
    this.trackIndex = proj.index
    this.lateral = proj.lateral

    let delta = proj.distance - this.lastDistance
    if (delta > this.track.length / 2) delta -= this.track.length
    if (delta < -this.track.length / 2) delta += this.track.length
    this.lastDistance = proj.distance

    if (Math.abs(delta) < 20 && Math.abs(proj.lateral) < this.track.halfWidth + 25) {
      this.progress += delta
    }

    if (running && !this.finished) this.time += dt

    const lapsDone = Math.floor(this.progress / this.track.length)
    while (this.lapTimes.length < Math.min(lapsDone, LAPS)) {
      const before = this.lapTimes.reduce((s, t) => s + t, 0)
      this.lapTimes.push(this.time - before)
    }
    this.lap = THREE.MathUtils.clamp(lapsDone + 1, 1, LAPS)
    if (lapsDone >= LAPS) this.finished = true
  }

  get lapProgress(): number {
    return THREE.MathUtils.clamp((this.progress / this.track.length) % 1, 0, 1)
  }

  /** 0 at the start line, 1 at the finish of the last lap. */
  get stageProgress(): number {
    return THREE.MathUtils.clamp(this.progress / (this.track.length * LAPS), 0, 1)
  }

  get currentLapTime(): number {
    return this.time - this.lapTimes.reduce((s, t) => s + t, 0)
  }
}

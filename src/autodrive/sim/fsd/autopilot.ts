import { kmh, LANES, laneCenter, laneOf, SPEED_LIMIT, STEP } from '../config'
import type { DriveCommand, SimState } from '../types'
import { trackTrajectory } from './control'
import { Perception, type Track } from './perception'
import { Planner, PLAN_TIMES, type PlanResult, type Trajectory } from './planner'
import { predict, type Predicted } from './prediction'
import { PROFILES, type ProfileName } from './profiles'

/**
 * The autopilot: perception at 30 Hz, prediction and planning at 10 Hz, control every physics
 * step. It also keeps what the displays need: the plan, the runners-up, the lead vehicle, and a
 * short explanation of what it is doing and why.
 */

const PERCEPTION_HZ = 30
const PLAN_HZ = 10

export type AutopilotStatus = {
  reason: string
  leadId: number | null
  /** Seconds of headway to the lead vehicle. */
  leadGap: number | null
  takeover: boolean
  signal: number
  laneChange: boolean
  vRef: number
}

export class Autopilot {
  readonly perception = new Perception()
  readonly planner = new Planner()
  engaged = false
  profileName: ProfileName = 'standard'
  /** Cruise set speed, m/s. */
  setSpeed = PROFILES.standard.cruise
  plan: Trajectory | null = null
  alternatives: Trajectory[] = []
  obstacles: Predicted[] = []
  status: AutopilotStatus = { reason: '', leadId: null, leadGap: null, takeover: false, signal: 0, laneChange: false, vRef: 0 }
  private request = 0
  private requestTimer = 0
  /** The lane change in progress was asked for by the driver. */
  private requested = false
  private nextPerception = 0
  private nextPlan = 0
  private takeoverTimer = 0
  lastPlanMs = 0

  get profile() {
    return PROFILES[this.profileName]
  }

  setProfile(name: ProfileName): void {
    this.profileName = name
    this.setSpeed = PROFILES[name].cruise
  }

  adjustSpeed(deltaKmh: number): void {
    this.setSpeed = Math.max(30 / 3.6, Math.min(250 / 3.6, Math.round((kmh(this.setSpeed) + deltaKmh) / 5) * 5 / 3.6))
  }

  /** Driver flicks the indicator stalk: ask for a lane change (+1 left, -1 right). */
  requestLaneChange(dir: number): void {
    this.request = dir
    this.requestTimer = 6
  }

  reset(sim: SimState): void {
    this.perception.reset()
    this.planner.reset(laneOf(sim.ego.d))
    this.plan = null
    this.alternatives = []
    this.request = 0
    this.nextPerception = 0
    this.nextPlan = 0
  }

  engage(sim: SimState): void {
    if (this.engaged) return
    this.engaged = true
    this.planner.reset(laneOf(sim.ego.d))
    this.plan = null
    this.nextPlan = 0
    // Tesla-style: engaging at speed keeps the current speed if it's above the profile cruise.
    this.setSpeed = Math.max(this.setSpeed, Math.min(this.profile.cruise * 1.0, sim.ego.v))
  }

  disengage(): void {
    this.engaged = false
    this.request = 0
  }

  /** Run perception (and planning when engaged); returns a command when engaged. */
  step(sim: SimState): DriveCommand | null {
    if (sim.t >= this.nextPerception) {
      this.perception.update(sim)
      this.nextPerception = sim.t + 1 / PERCEPTION_HZ - STEP / 2
    }
    if (!this.engaged) {
      this.plan = null
      this.status.takeover = false
      return null
    }
    if (this.requestTimer > 0) {
      this.requestTimer -= STEP
      if (this.requestTimer <= 0) this.request = 0
    }
    if (sim.t >= this.nextPlan || !this.plan) {
      const t0 = performance.now()
      this.replan(sim)
      this.lastPlanMs = performance.now() - t0
      this.nextPlan = sim.t + 1 / PLAN_HZ - STEP / 2
    }
    const cmd = trackTrajectory(this.plan!, sim.ego, sim.road, sim.t)
    cmd.signal = this.status.signal
    return cmd
  }

  private replan(sim: SimState): void {
    const e = sim.ego
    this.obstacles = predict(this.perception.tracks.values(), this.perception.spikes, e, PLAN_TIMES)
    const result = this.planner.plan({
      t: sim.t,
      ego: e,
      road: sim.road,
      obstacles: this.obstacles,
      profile: this.profile,
      setSpeed: this.setSpeed,
      request: this.request,
    })
    this.plan = result.best
    this.alternatives = result.alternatives
    // Request satisfied once we've committed to that lane.
    if (this.request !== 0 && this.planner.changing && this.planner.targetLane === this.planner.fromLane - this.request) {
      this.request = 0
      this.requested = true
    }
    if (!this.planner.changing) this.requested = false
    if (this.request !== 0) {
      const goal = laneOf(e.d) - this.request
      if (goal < 0 || goal >= LANES) this.request = 0
    }
    this.describe(sim, result)
  }

  private describe(sim: SimState, r: PlanResult): void {
    const e = sim.ego
    const p = r.best
    const st = this.status
    // Lead vehicle: nearest track ahead in the corridor we're heading into.
    let lead: Track | null = null
    let leadDist = Infinity
    for (const t of this.perception.tracks.values()) {
      if (t.kind === 'oncoming') continue
      const ds = t.s - e.s
      if (ds <= 0 || ds > 150) continue
      if (Math.abs(t.d - p.targetD) > (t.width + e.width) / 2) continue
      if (ds < leadDist) {
        leadDist = ds
        lead = t
      }
    }
    st.leadId = lead ? lead.id : null
    st.leadGap = lead ? (leadDist - (lead.length + e.length) / 2) / Math.max(1, e.v) : null
    st.laneChange = this.planner.changing
    st.signal = this.planner.changing
      ? Math.sign(laneCenter(this.planner.targetLane) - e.d)
      : this.planner.pendingLane !== null
        ? Math.sign(laneCenter(this.planner.pendingLane) - e.d)
        : 0
    st.vRef = r.vRef
    if (!r.feasible && p.collision < 2.5) this.takeoverTimer = 2.5
    else this.takeoverTimer = Math.max(0, this.takeoverTimer - 1 / PLAN_HZ)
    st.takeover = this.takeoverTimer > 0

    const near = (kind: Track['kind'], range: number) =>
      [...this.perception.tracks.values()].some((t) => t.kind === kind && t.s - e.s > -5 && t.s - e.s < range)
    const threatened = [...this.perception.tracks.values()].some((t) => t.threat > 0.35)
    const spikes = this.perception.spikes.some((k) => k.s - e.s > 0 && k.s - e.s < 180)
    if (st.takeover) st.reason = 'Take over immediately'
    else if (e.tiresBlown) st.reason = 'Tyre damage · limiting speed'
    else if (threatened && (p.laneChange || Math.abs(p.targetD - laneCenter(p.refLane)) > 0.3)) st.reason = 'Evading police unit'
    else if (spikes && p.laneChange) st.reason = 'Avoiding spike strip'
    else if (near('block', 260) && p.laneChange) st.reason = 'Routing through roadblock gap'
    else if (near('wreck', 150) && p.laneChange) st.reason = 'Avoiding crashed vehicle'
    else if (p.vTarget < Math.max(2, e.v * 0.5) && (near('block', 200) || near('wreck', 200) || spikes)) st.reason = 'Obstacle ahead · stopping'
    else if ((this.planner.changing && this.requested) || this.request !== 0) st.reason = 'Lane change requested'
    else if (this.planner.changing && this.planner.targetLane > this.planner.fromLane && this.profile.keepRight > 0 && !(lead && lead.vs < r.vRef - 3)) st.reason = 'Moving out of passing lane'
    else if (this.planner.changing) st.reason = 'Changing lanes to pass slower traffic'
    else if (lead && st.leadGap !== null && st.leadGap < this.profile.headway * 1.6 + 0.6 && lead.vs < r.vRef - 1) st.reason = `Following vehicle ahead · ${st.leadGap.toFixed(1)} s`
    else if (r.vCurve < this.setSpeed - 2) st.reason = 'Slowing for curve'
    else if (this.setSpeed > SPEED_LIMIT + 1 && near('police', 200)) st.reason = 'Police nearby'
    else st.reason = `Cruising at ${Math.round(kmh(this.setSpeed))} km/h`
  }
}

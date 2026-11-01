import { nextRandom } from '../../flyer/sim/rng'
import { EGO, laneCenter, PHYS, POLICE, STEP } from './config'
import { overlap } from './collide'
import { heatLevel, isChasing, maintainPolice, stepPolice } from './police'
import { Road } from './road'
import { flowBodies, maintainTraffic, populateTraffic, stepCivilian } from './traffic'
import type { Agent, Body, DriveCommand, Mode, SimState } from './types'
import { createEgo, stepEgo } from './vehicle'

export function createSim(seed: number, mode: Mode): SimState {
  const road = new Road(seed)
  road.ensure(3000)
  const sim: SimState = {
    t: 0,
    rng: seed,
    seed,
    mode,
    phase: 'drive',
    road,
    ego: createEgo(80, laneCenter(1), 26),
    agents: [],
    spikes: [],
    cams: [],
    roadblocks: [],
    events: [],
    nextId: 1,
    heat: 0,
    pursuit: false,
    bust: 0,
    cooldown: 0,
    bounty: 0,
    cleanDistance: 0,
    stats: { collisions: 0, nearMisses: 0, escapes: 0, takedowns: 0, maxSpeed: 0, interventions: 0 },
    nextCam: 1100,
    nextPatrol: 1700,
    nextSpikes: Infinity,
    nextRoadblock: Infinity,
    autopilot: false,
  }
  populateTraffic(sim)
  return sim
}

const passSide = new WeakMap<Agent, number>()

function massOf(b: Body): number {
  if (b.id === 0) return EGO.mass
  const a = b as Agent
  if (a.role === 'block') return 1e6
  if (a.kind === 'truck') return 9000
  if (a.kind === 'van') return 2600
  return a.role === 'cop' ? 2000 : 1700
}

/** Velocity of a body in (s, d). */
function velocityOf(b: Body): [number, number] {
  if (b.id === 0) return [b.v * Math.cos(b.psi), b.v * Math.sin(b.psi)]
  const a = b as Agent
  return [a.v * a.dir, a.vd]
}

/** Impulse response between two bodies; returns the speed change each received. */
function resolve(sim: SimState, a: Body, b: Body): [number, number] | null {
  const hit = overlap(a, b)
  if (!hit) return null
  const ma = massOf(a)
  const mb = massOf(b)
  const total = ma + mb
  const push = hit.depth + 0.01
  a.s -= hit.ns * push * (mb / total)
  a.d -= hit.nd * push * (mb / total)
  b.s += hit.ns * push * (ma / total)
  b.d += hit.nd * push * (ma / total)
  const va = velocityOf(a)
  const vb = velocityOf(b)
  const rel = (vb[0] - va[0]) * hit.ns + (vb[1] - va[1]) * hit.nd
  if (rel >= 0) return [0, 0]
  const j = (-(1 + PHYS.restitution) * rel) / (1 / ma + 1 / mb)
  // Tangential friction between the bodies.
  const ts = -hit.nd
  const td = hit.ns
  const relT = (vb[0] - va[0]) * ts + (vb[1] - va[1]) * td
  const jt = Math.max(-0.3 * j, Math.min(0.3 * j, -relT / (1 / ma + 1 / mb)))
  const ia: [number, number] = [-(j * hit.ns + jt * ts) / ma, -(j * hit.nd + jt * td) / ma]
  const ib: [number, number] = [(j * hit.ns + jt * ts) / mb, (j * hit.nd + jt * td) / mb]
  apply(a, va, ia)
  apply(b, vb, ib)
  void sim
  return [Math.hypot(ia[0], ia[1]), Math.hypot(ib[0], ib[1])]
}

function apply(b: Body, v: [number, number], dv: [number, number]): void {
  const vs = v[0] + dv[0]
  const vd = v[1] + dv[1]
  if (b.id === 0) {
    // The hero car keeps its kinematic state: speed along its heading, and a yaw kick from the side impulse.
    const fs = Math.cos(b.psi)
    const fd = Math.sin(b.psi)
    b.v = vs * fs + vd * fd
    const side = -vs * fd + vd * fs
    b.psi += Math.max(-0.35, Math.min(0.35, side / Math.max(6, Math.abs(b.v)))) * 0.8
    return
  }
  const a = b as Agent
  if (a.role === 'block') return
  a.v = Math.max(0, vs * a.dir)
  a.vd = vd
}

function wreck(sim: SimState, a: Agent, impact: number): void {
  if (a.wrecked >= 0 || a.role === 'block') return
  a.wrecked = 0
  a.spin = (nextRandom(sim) < 0.5 ? -1 : 1) * Math.min(4, 0.8 + impact * 0.3)
  if (a.role === 'cop') {
    sim.stats.takedowns++
    sim.events.push({ type: 'copWrecked', id: a.id })
    sim.events.push({ type: 'bounty', amount: 1500, label: 'COP TAKEN OUT' })
  } else {
    sim.events.push({ type: 'agentCrash', id: a.id, impact })
  }
}

function collisions(sim: SimState): void {
  const e = sim.ego
  for (const a of sim.agents) {
    if (a.role === 'oncoming') continue
    if (Math.abs(a.s - e.s) > 12 || Math.abs(a.d - e.d) > 6) continue
    const dv = resolve(sim, e, a)
    if (!dv || dv[0] + dv[1] < 0.3) continue
    const impact = dv[0]
    e.damage = Math.min(1, e.damage + impact * PHYS.damagePerImpact)
    sim.stats.collisions++
    sim.cleanDistance = 0
    sim.events.push({ type: 'collision', id: a.id, impact: Math.max(impact, dv[1]), role: a.role })
    if (a.role === 'cop') {
      a.health -= dv[1] * 0.1
      if (a.health <= 0 || dv[1] > PHYS.wreckImpact) wreck(sim, a, dv[1])
      else if (a.copState === 'ram') a.copState = 'flank'
    } else if (dv[1] > PHYS.wreckImpact * 0.7) wreck(sim, a, dv[1])
    // Hitting anything during a pursuit makes it worse.
    if (sim.pursuit && impact > 2) sim.heat = Math.min(POLICE.maxHeat + 0.99, sim.heat + 0.05)
  }
  // Interceptors are not immune to traffic.
  for (const c of sim.agents) {
    if (c.role !== 'cop' || c.wrecked >= 0 || c.copState === 'parked') continue
    for (const a of sim.agents) {
      if (a === c || a.role === 'oncoming') continue
      if (Math.abs(a.s - c.s) > 12 || Math.abs(a.d - c.d) > 5) continue
      const dv = resolve(sim, c, a)
      if (!dv) continue
      if (dv[0] > 5 || (c.health -= dv[0] * 0.12) <= 0) wreck(sim, c, dv[0])
      if (a.role === 'traffic' && dv[1] > PHYS.wreckImpact * 0.7) wreck(sim, a, dv[1])
    }
  }
}

function hazards(sim: SimState): void {
  const e = sim.ego
  for (const k of sim.spikes) {
    if (k.hit || k.passed) continue
    const hw = e.width / 2
    if (Math.abs(e.s - k.s) < e.length / 2 + 0.4 && e.d + hw > k.d0 && e.d - hw < k.d1) {
      k.hit = true
      if (!e.tiresBlown) {
        e.tiresBlown = true
        sim.cleanDistance = 0
        sim.events.push({ type: 'spiked' })
      }
    } else if (e.s - k.s > e.length) {
      k.passed = true
      sim.events.push({ type: 'spikesDodged' })
      sim.events.push({ type: 'bounty', amount: 400, label: 'SPIKES DODGED' })
    }
  }
  for (const r of sim.roadblocks) {
    if (r.passed || e.s < r.s + 6) continue
    r.passed = true
    sim.events.push({ type: 'roadblockPassed' })
    sim.events.push({ type: 'bounty', amount: 1000, label: 'ROADBLOCK EVADED' })
  }
}

function nearMisses(sim: SimState): void {
  const e = sim.ego
  for (const a of sim.agents) {
    if (a.role !== 'traffic' || a.wrecked >= 0) continue
    const side = Math.sign(a.s - e.s)
    const prev = passSide.get(a)
    passSide.set(a, side)
    if (prev === undefined || prev === side || side > 0) continue
    const gap = Math.abs(a.d - e.d) - (a.width + e.width) / 2
    const rel = e.v - a.v
    if (gap < 1.0 && gap > -0.2 && rel > 7) {
      sim.stats.nearMisses++
      sim.events.push({ type: 'nearMiss', id: a.id, speed: rel })
      sim.events.push({ type: 'bounty', amount: Math.round(100 + rel * 8), label: 'NEAR MISS' })
    }
  }
}

export function step(sim: SimState, cmd: DriveCommand): void {
  const e = sim.ego
  const firstEvent = sim.events.length
  const odometer = e.odometer
  sim.t += STEP
  sim.road.ensure(e.s + 1500)
  const frozen = sim.phase !== 'drive'
  stepEgo(e, frozen ? { accel: -EGO.maxBrake, steer: e.steer } : cmd, sim.road, STEP, sim.events)
  sim.stats.maxSpeed = Math.max(sim.stats.maxSpeed, e.v)

  const bodies = flowBodies(sim)
  for (const a of sim.agents) if (a.role === 'traffic' || a.role === 'oncoming') stepCivilian(sim, a, bodies, STEP)
  stepPolice(sim, bodies, STEP)
  collisions(sim)
  hazards(sim)
  nearMisses(sim)

  // Every ~0.25 s: keep the traffic window and police features topped up.
  if (Math.floor(sim.t * 4) !== Math.floor((sim.t - STEP) * 4)) {
    maintainTraffic(sim)
    maintainPolice(sim)
  }

  // Distance bounty, and a bonus per clean autopilot kilometre.
  if (sim.phase === 'drive') sim.bounty += ((e.odometer - odometer) / 10) * (1 + heatLevel(sim))
  if (sim.autopilot && sim.phase === 'drive') {
    const before = Math.floor(sim.cleanDistance / 1000)
    sim.cleanDistance += Math.abs(e.v) * STEP
    if (Math.floor(sim.cleanDistance / 1000) > before) sim.events.push({ type: 'bounty', amount: 500, label: 'AUTOPILOT · CLEAN KM' })
  }
  for (let i = firstEvent; i < sim.events.length; i++) {
    const ev = sim.events[i]
    if (ev.type === 'bounty') sim.bounty += ev.amount
  }

  if (e.damage >= 1 && sim.phase === 'drive') {
    sim.phase = 'wrecked'
    sim.events.push({ type: 'wrecked' })
  }
}

export function nearestChaser(sim: SimState): Agent | null {
  let best: Agent | null = null
  let dist = Infinity
  for (const a of sim.agents) {
    if (!isChasing(a)) continue
    const d = Math.abs(a.s - sim.ego.s)
    if (d < dist) {
      dist = d
      best = a
    }
  }
  return best
}

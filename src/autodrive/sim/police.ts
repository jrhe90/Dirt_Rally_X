import { nextRandom, randomRange } from '../../flyer/sim/rng'
import { LANES, laneCenter, laneOf, POLICE, ROAD_EDGE, SHOULDER, SPEED_LIMIT } from './config'
import { idm, neighbor, createAgent, stepWreck } from './traffic'
import type { Agent, Body, SimState } from './types'

/**
 * Hot-pursuit police. Speeding past a speed camera or a parked patrol car starts a pursuit.
 * Heat (1–5) climbs while the pursuit lasts and sets how many interceptors chase, how fast they
 * are, and what they deploy: spike strips from heat 2 and roadblocks from heat 3. Interceptors
 * close in from behind, pull alongside and ram. Hold still near them and you are busted; get
 * far enough away for long enough and you escape.
 */

export function heatLevel(sim: SimState): number {
  return Math.min(POLICE.maxHeat, Math.floor(sim.heat))
}

export function isChasing(a: Agent): boolean {
  return a.role === 'cop' && a.wrecked < 0 && a.copState !== 'parked' && a.copState !== 'retreat'
}

function copTopSpeed(sim: SimState): number {
  return 52 + heatLevel(sim) * 3.2
}

export function startPursuit(sim: SimState): void {
  if (sim.pursuit || sim.mode !== 'pursuit') return
  sim.pursuit = true
  sim.heat = Math.max(1, sim.heat)
  sim.cooldown = 0
  sim.nextSpikes = sim.ego.s + 900
  sim.nextRoadblock = sim.ego.s + 1500
  sim.events.push({ type: 'pursuit' })
  sim.events.push({ type: 'heat', level: heatLevel(sim) })
}

function spawnInterceptor(sim: SimState, behind: boolean): void {
  const e = sim.ego
  const lane = Math.floor(nextRandom(sim) * LANES)
  const s = behind ? e.s - randomRange(sim, 160, 240) : e.s + randomRange(sim, 300, 420)
  const d = laneCenter(lane)
  for (const a of sim.agents) if (a.role !== 'oncoming' && Math.abs(a.s - s) < 14 && Math.abs(a.d - d) < 3) return
  const cop = createAgent(sim, 'cop', 'cop', s, lane, behind ? Math.max(30, e.v + 6) : Math.max(18, e.v * 0.6))
  cop.copState = 'chase'
  cop.color = 0
  sim.agents.push(cop)
}

/** Parked patrol cars on the shoulder, waiting for speeders. */
export function maintainPolice(sim: SimState): void {
  const e = sim.ego
  if (sim.mode !== 'pursuit') return
  while (sim.nextPatrol < e.s + 650) {
    const s = sim.nextPatrol
    const cop = createAgent(sim, 'cop', 'cop', s, LANES, 0)
    cop.d = -(ROAD_EDGE - SHOULDER * 0.5)
    cop.copState = 'parked'
    cop.psi = 0
    sim.agents.push(cop)
    sim.nextPatrol += randomRange(sim, 1800, 3200)
  }
  while (sim.nextCam < e.s + 650) {
    sim.cams.push({ s: sim.nextCam, d: -(ROAD_EDGE + 1.2), flashed: false })
    sim.nextCam += randomRange(sim, 1300, 2300)
  }
  sim.cams = sim.cams.filter((c) => c.s > e.s - 200)
  sim.spikes = sim.spikes.filter((k) => k.s > e.s - 200)
  sim.roadblocks = sim.roadblocks.filter((r) => r.s > e.s - 300)

  if (!sim.pursuit) return
  const chasing = sim.agents.filter((a) => isChasing(a)).length
  const wanted = Math.min(5, 1 + heatLevel(sim))
  if (chasing < wanted && nextRandom(sim) < 0.02) spawnInterceptor(sim, nextRandom(sim) < 0.8)

  const level = heatLevel(sim)
  if (level >= 2 && e.s > sim.nextSpikes) {
    deploySpikes(sim)
    sim.nextSpikes = e.s + randomRange(sim, 1100, 1900) / (1 + (level - 2) * 0.25)
  }
  if (level >= 3 && e.s > sim.nextRoadblock) {
    deployRoadblock(sim)
    sim.nextRoadblock = e.s + randomRange(sim, 2200, 3200)
  }
}

function deploySpikes(sim: SimState): void {
  const e = sim.ego
  const s = e.s + Math.max(260, e.v * 7)
  // Never in a roadblock's gap: one hazard at a time.
  if (sim.roadblocks.some((r) => Math.abs(r.s - s) < 400)) return
  const lanes = heatLevel(sim) >= 4 ? 2 : 1
  // Lay them across the hero car's predicted lane.
  const lane = Math.min(LANES - lanes, laneOf(e.d))
  const d0 = laneCenter(lane + lanes - 1) - 1.75
  const d1 = laneCenter(lane) + 1.75
  sim.spikes.push({ id: sim.nextId++, s, d0, d1, hit: false, passed: false, age: 0 })
  sim.events.push({ type: 'spikesDropped', id: sim.spikes[sim.spikes.length - 1].id })
}

function deployRoadblock(sim: SimState): void {
  const e = sim.ego
  const s = e.s + Math.max(520, e.v * 11)
  if (sim.spikes.some((k) => Math.abs(k.s - s) < 400)) {
    sim.nextRoadblock = e.s + 300
    return
  }
  const gapLane = Math.floor(nextRandom(sim) * LANES)
  for (let lane = 0; lane <= LANES; lane++) {
    if (lane === gapLane) continue
    // Two cars nose to nose across the lane, angled.
    const cop = createAgent(sim, 'block', 'cop', s, Math.min(lane, LANES - 1), 0)
    // Angled across the lane, nudged away from the gap so it stays drivable.
    const away = lane < gapLane ? 1 : -1
    cop.d = laneCenter(lane) + away * 0.35
    if (lane === LANES) cop.d = -(ROAD_EDGE - 1.6)
    cop.psi = (lane % 2 ? 1 : -1) * 0.55
    cop.copState = 'parked'
    sim.agents.push(cop)
  }
  // Clear civilian traffic out of the way so the block is readable.
  sim.agents = sim.agents.filter((a) => a.role !== 'traffic' || Math.abs(a.s - s) > 25)
  sim.roadblocks.push({ s, gapLane, passed: false })
  sim.events.push({ type: 'roadblock' })
}

/** One interceptor's driving: catch up, pull alongside, ram. */
function stepCop(sim: SimState, c: Agent, bodies: readonly Body[], dt: number): void {
  const e = sim.ego
  if (c.wrecked >= 0) {
    stepWreck(c, dt)
    return
  }
  if (c.role === 'block' || c.copState === 'parked') {
    c.v = 0
    if (c.role === 'cop' && sim.pursuit && e.s - c.s > 5 && e.s - c.s < 120) {
      // A patrol car joins the chase once we're past it.
      c.copState = 'chase'
      c.v = 6
    }
    return
  }
  c.stateTimer -= dt
  const top = copTopSpeed(sim)
  const ds = e.s - c.s
  let wantS: number
  let wantD = c.copTargetD
  if (c.copState === 'retreat') {
    wantS = e.s - 400
    if (c.stateTimer <= 0) c.copState = 'chase'
  } else if (ds > 14) {
    c.copState = 'chase'
    wantS = e.s
  } else if (c.copState === 'ram') {
    wantS = e.s + 0.5
    wantD = e.d
    if (c.stateTimer <= 0) {
      c.copState = 'flank'
      c.stateTimer = randomRange(sim, 1.2, 2.4)
    }
  } else {
    c.copState = 'flank'
    wantS = e.s - 0.5
    if (c.stateTimer <= 0 && Math.abs(ds) < 3 && e.v > 5) {
      c.copState = 'ram'
      c.stateTimer = 1.1
    }
  }
  if (c.copState === 'chase' || c.copState === 'flank') {
    // Pick the lane beside the hero car with room, or right behind it to rear-end.
    const egoLane = laneOf(e.d)
    if (ds > 40 || c.stateTimer <= -3) {
      // Far away: go around traffic in whichever lane has the longest clear run.
      let best = c.copTargetD || laneCenter(egoLane)
      let bestGap = -1
      for (let lane = 0; lane < LANES; lane++) {
        const lc = laneCenter(lane)
        const g = neighbor(c, bodies, lc - 1.1, lc + 1.1, 1).gap
        const score = Math.min(g, ds) - Math.abs(lc - c.d) * 2
        if (score > bestGap) {
          bestGap = score
          best = lc
        }
      }
      wantD = best
      c.stateTimer = Math.max(c.stateTimer, 0)
    } else {
      const side = egoLane === 0 ? -1 : egoLane >= LANES - 1 ? 1 : c.d > e.d ? 1 : -1
      wantD = c.copState === 'flank' ? e.d + side * 3.3 : laneCenter(egoLane)
    }
    c.copTargetD = wantD
  }

  // Longitudinal: chase speed, but don't plough into traffic ahead in our path.
  const lead = neighbor(c, bodies, Math.min(c.d, wantD) - 1.0, Math.max(c.d, wantD) + 1.0, 1)
  const ahead = lead.body === e ? Infinity : lead.gap
  // Close in at a bounded relative speed so the approach is readable (and survivable).
  const gap = wantS - c.s
  let desired: number
  if (c.copState === 'retreat') desired = Math.max(10, e.v - 15)
  else if (Math.abs(ds) < 14) desired = e.v + Math.max(-5, Math.min(5, gap * 1.2))
  else desired = e.v + Math.max(-0.35 * e.v, Math.min(c.copState === 'chase' && ds > 120 ? 16 : 10, gap * 0.25))
  desired = Math.max(0, Math.min(top, desired))
  let accel = idm(c.v, Math.max(1, desired), ahead, lead.body ? c.v - lead.body.v : 0, 0.6, 4.5, 5)
  if (Math.abs(ds) < 14 && c.copState !== 'retreat') accel = Math.max(-8, Math.min(6, (desired - c.v) * 2.5))
  c.accel = accel
  c.v = Math.max(0, Math.min(top, c.v + accel * dt))
  c.s += c.v * dt

  const latMax = c.copState === 'ram' ? 3.4 : 2.4
  const want = Math.max(-latMax, Math.min(latMax, (wantD - c.d) * 1.6))
  c.vd += Math.max(-5 * dt, Math.min(5 * dt, want - c.vd))
  c.d += c.vd * dt
  const minD = -ROAD_EDGE + 1.1
  const maxD = -1.4
  if (c.d < minD || c.d > maxD) {
    c.d = Math.max(minD, Math.min(maxD, c.d))
    c.vd = 0
  }
  c.psi = Math.atan2(c.vd, Math.max(4, c.v))
  c.lane = laneOf(c.d)
}

export function stepPolice(sim: SimState, bodies: readonly Body[], dt: number): void {
  const e = sim.ego
  for (const a of sim.agents) if (a.role === 'cop' || a.role === 'block') stepCop(sim, a, bodies, dt)

  for (const k of sim.spikes) k.age += dt
  if (sim.mode !== 'pursuit') return

  // Speed cameras and patrol cars notice speeders.
  for (const cam of sim.cams) {
    if (cam.flashed || e.s < cam.s) continue
    cam.flashed = true
    if (e.v > SPEED_LIMIT + POLICE.speedTrapMargin) {
      sim.events.push({ type: 'speedcam', kmh: Math.round(e.v * 3.6) })
      sim.events.push({ type: 'bounty', amount: Math.round((e.v - SPEED_LIMIT) * 3.6 * 10), label: 'SPEED CAMERA' })
      if (sim.pursuit) sim.heat = Math.min(POLICE.maxHeat + 0.99, sim.heat + 0.5)
      else startPursuit(sim)
    }
  }
  if (!sim.pursuit) {
    for (const a of sim.agents) {
      if (a.role === 'cop' && a.copState === 'parked' && e.s > a.s - 60 && e.s < a.s + 10 && e.v > SPEED_LIMIT + POLICE.pursuitMargin) {
        startPursuit(sim)
        break
      }
    }
    return
  }

  // Heat builds over the length of the pursuit.
  const before = heatLevel(sim)
  sim.heat = Math.min(POLICE.maxHeat + 0.99, sim.heat + (POLICE.heatPerMinute / 60) * dt)
  if (heatLevel(sim) > before) sim.events.push({ type: 'heat', level: heatLevel(sim) })

  // Bust meter: slow and next to a cop.
  let nearest = Infinity
  let pinned = false
  for (const a of sim.agents) {
    if (a.role !== 'cop' && a.role !== 'block') continue
    if (a.wrecked >= 0) continue
    if (a.role === 'cop' && !isChasing(a)) continue
    const dist = Math.hypot(a.s - e.s, a.d - e.d)
    if (isChasing(a)) nearest = Math.min(nearest, Math.abs(a.s - e.s))
    if (dist < POLICE.bustRadius) pinned = true
  }
  if (pinned && Math.abs(e.v) < POLICE.bustSpeed) sim.bust = Math.min(1, sim.bust + POLICE.bustRate * dt * (e.tiresBlown ? 1.6 : 1))
  else sim.bust = Math.max(0, sim.bust - 0.35 * dt)
  if (sim.bust >= 1 && sim.phase === 'drive') {
    sim.phase = 'busted'
    sim.events.push({ type: 'busted' })
  }

  // Escape: keep every interceptor beyond reach for long enough.
  if (nearest > POLICE.escapeDistance) {
    sim.cooldown += dt
    if (sim.cooldown >= POLICE.escapeTime) escape(sim)
  } else {
    sim.cooldown = Math.max(0, sim.cooldown - dt * 2)
  }
}

function escape(sim: SimState): void {
  const level = heatLevel(sim)
  sim.events.push({ type: 'escaped', heat: level })
  sim.events.push({ type: 'bounty', amount: 2500 * level, label: 'ESCAPED' })
  sim.stats.escapes++
  sim.pursuit = false
  sim.cooldown = 0
  sim.bust = 0
  sim.heat = Math.max(0, sim.heat - 1.5)
  for (const a of sim.agents) {
    if (a.role === 'cop' && a.copState !== 'parked' && a.wrecked < 0) {
      a.copState = 'retreat'
      a.stateTimer = 999
    }
  }
}

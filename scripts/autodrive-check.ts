/**
 * Headless checks for the self-driving simulator. The autopilot drives each profile through
 * traffic on several seeds and must not hit anything; in Pursuit it is chased at high heat and
 * must dodge spike strips and roadblocks (collisions caused by police rams are reported but
 * not counted against it).
 *
 *   npm run test:autodrive               # all profiles
 *   npm run test:autodrive -- hurry 600  # one profile, 600 s per seed
 */
import { kmh, STEP } from '../src/autodrive/sim/config'
import { Autopilot } from '../src/autodrive/sim/fsd/autopilot'
import { PROFILE_ORDER, type ProfileName } from '../src/autodrive/sim/fsd/profiles'
import { startPursuit } from '../src/autodrive/sim/police'
import { createSim, step } from '../src/autodrive/sim/world'

type Result = {
  profile: string
  seed: number
  km: number
  avgKmh: number
  civilianHits: number
  copHits: number
  laneChanges: number
  aborts: number
  spiked: boolean
  spikesDodged: number
  roadblocks: number
  outcome: string
  takeovers: number
  planMs: number
  maxLat: number
}

function drive(profile: ProfileName, seed: number, seconds: number): Result {
  const pursuit = profile === 'pursuit'
  const sim = createSim(seed, pursuit ? 'pursuit' : 'cruise')
  const ap = new Autopilot()
  ap.setProfile(profile)
  ap.reset(sim)
  ap.engage(sim)
  const r: Result = {
    profile,
    seed,
    km: 0,
    avgKmh: 0,
    civilianHits: 0,
    copHits: 0,
    laneChanges: 0,
    aborts: 0,
    spiked: false,
    spikesDodged: 0,
    roadblocks: 0,
    outcome: 'ok',
    takeovers: 0,
    planMs: 0,
    maxLat: 0,
  }
  let wasChanging = false
  let wasTarget = -1
  let wasTakeover = false
  let plans = 0
  let planTime = 0
  const steps = Math.round(seconds / STEP)
  let started = false
  for (let i = 0; i < steps; i++) {
    if (pursuit && !started && sim.t > 5) {
      startPursuit(sim)
      sim.heat = 3.5
      started = true
    }
    sim.autopilot = true
    const cmd = ap.step(sim) ?? { accel: 0, steer: 0 }
    if (ap.lastPlanMs) {
      planTime += ap.lastPlanMs
      plans++
      ap.lastPlanMs = 0
    }
    step(sim, cmd)
    r.maxLat = Math.max(r.maxLat, Math.abs(sim.ego.latAccel))
    if (ap.planner.changing && !wasChanging) r.laneChanges++
    if (!ap.planner.changing && wasChanging && ap.planner.targetLane !== ap.planner.fromLane) r.aborts++
    if (ap.planner.changing && wasChanging && wasTarget !== ap.planner.targetLane) r.aborts++
    wasTarget = ap.planner.targetLane
    wasChanging = ap.planner.changing
    if (ap.status.takeover && !wasTakeover) r.takeovers++
    wasTakeover = ap.status.takeover
    for (const e of sim.events) {
      if (e.type === 'collision' && e.impact > 0.3) {
        if (e.role === 'cop') r.copHits++
        else r.civilianHits++
        if (process.env.VERBOSE) console.log(`  t=${sim.t.toFixed(1)} hit ${e.role} #${e.id} impact ${e.impact.toFixed(1)} v=${kmh(sim.ego.v).toFixed(0)} reason="${ap.status.reason}"`)
      }
      if (e.type === 'spiked') r.spiked = true
      if (e.type === 'spikesDodged') r.spikesDodged++
      if (e.type === 'roadblockPassed') r.roadblocks++
      if (e.type === 'busted') r.outcome = 'BUSTED'
      if (e.type === 'wrecked') r.outcome = 'WRECKED'
      if (e.type === 'escaped') r.outcome = r.outcome === 'ok' ? 'escaped' : r.outcome
    }
    sim.events.length = 0
    if (sim.phase !== 'drive') break
  }
  r.km = sim.ego.odometer / 1000
  r.avgKmh = (sim.ego.odometer / sim.t) * 3.6
  r.planMs = plans ? planTime / plans : 0
  return r
}

const [only, secondsArg] = process.argv.slice(2)
const seconds = Number(secondsArg) || 240
const profiles = PROFILE_ORDER.filter((p) => !only || p === only)
const seeds = [1, 2, 3, 4]
let failed = false
for (const profile of profiles) {
  for (const seed of seeds) {
    const r = drive(profile, seed, seconds)
    const bad = r.civilianHits > 0 || (profile !== 'pursuit' && r.takeovers > 0) || (r.spiked && profile === 'pursuit')
    if (bad) failed = true
    console.log(
      `${bad ? 'FAIL' : 'ok  '} ${profile.padEnd(8)} seed ${seed}: ${r.km.toFixed(1)} km avg ${r.avgKmh.toFixed(0)} km/h, ` +
        `${r.laneChanges} lane changes (${r.aborts} aborted), hits civ ${r.civilianHits} cop ${r.copHits}, takeovers ${r.takeovers}, ` +
        `maxLat ${r.maxLat.toFixed(1)}, plan ${r.planMs.toFixed(2)} ms` +
        (profile === 'pursuit' ? `, spikes dodged ${r.spikesDodged}${r.spiked ? ' SPIKED' : ''}, roadblocks ${r.roadblocks}, ${r.outcome}` : ''),
    )
  }
}
process.exit(failed ? 1 : 0)

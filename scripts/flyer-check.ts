/**
 * Headless fairness check for Thrust Runner. A look-ahead bot (hold / release only, no rolls)
 * flies every obstacle pattern at the low, middle and high end of its difficulty range, then
 * does full runs. Fails if some pattern cannot be survived.
 *
 *   npm run test:flyer            # all patterns + 12 full runs
 *   npm run test:flyer -- convoy  # only patterns whose name contains "convoy"
 */
import { Autopilot } from '../src/flyer/sim/bot'
import { DIFFICULTY_RAMP } from '../src/flyer/sim/config'
import { PATTERNS, spawnPattern, type Pattern } from '../src/flyer/sim/patterns'
import { createSim, distanceOf, startRun, step } from '../src/flyer/sim/sim'
import type { SimState } from '../src/flyer/sim/types'

type Result = { ok: boolean; distance: number; cause?: string; pattern?: string }

function fly(s: SimState, untilX: number, maxSeconds: number): Result {
  const pilot = new Autopilot()
  const deadline = s.t + maxSeconds
  while (s.car.x < untilX && s.t < deadline) {
    step(s, pilot.input(s))
    const crash = s.events.find((e) => e.type === 'crash')
    s.events.length = 0
    if (crash && crash.type === 'crash') return { ok: false, distance: distanceOf(s), cause: crash.kind, pattern: s.lastPattern }
  }
  return { ok: true, distance: distanceOf(s) }
}

function checkPattern(pattern: Pattern, d: number, seed: number): Result {
  const s = createSim(seed)
  startRun(s)
  // Pretend we are far enough into the run for this difficulty (sets speed too).
  s.startX = s.car.x - d * DIFFICULTY_RAMP
  s.spawnX = s.car.x + 40
  s.lastPattern = 'warmup'
  spawnPattern(s, pattern)
  const end = s.spawnX
  s.spawnX = Infinity
  return fly(s, end + 20, 30)
}

const filter = process.argv[2] ?? ''
let failures = 0

console.log('Patterns (hold / release bot, no rolls):')
for (const pattern of PATTERNS.filter((p) => p.name.includes(filter))) {
  const max = pattern.max ?? 1
  const levels = [...new Set([pattern.min, (pattern.min + max) / 2, max])]
  const failed: string[] = []
  let runs = 0
  for (const d of levels) {
    for (let seed = 1; seed <= 12; seed++) {
      runs++
      const r = checkPattern(pattern, d, seed * 7919 + Math.round(d * 1000))
      if (!r.ok) failed.push(`d=${d.toFixed(2)} seed=${seed} (${r.cause})`)
    }
  }
  failures += failed.length
  console.log(`  ${failed.length ? '✗' : '✓'} ${pattern.name.padEnd(20)} ${runs - failed.length}/${runs}`)
  for (const f of failed.slice(0, 4)) console.log(`      ${f}`)
}

if (!filter) {
  console.log('\nFull runs to 5000 m:')
  for (let seed = 1; seed <= 12; seed++) {
    const s = createSim(seed * 104729)
    startRun(s)
    const r = fly(s, 5000, 400)
    if (!r.ok) failures++
    console.log(`  ${r.ok ? '✓' : '✗'} seed ${seed}: ${Math.round(r.distance)} m${r.ok ? '' : ` — ${r.cause} in ${r.pattern}`}`)
  }
}

if (failures) {
  console.log(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll patterns survivable.')

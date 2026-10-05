import type { Track } from '../track'
import type lines from './codriverLines.json'

export type ClipKey = keyof typeof lines

export type PaceNoteKind = 'corner' | 'jump' | 'crest' | 'tarmac' | 'gravel'

export type PaceNote = {
  kind: PaceNoteKind
  /** Lap distance where the feature begins. */
  distance: number
  /** Lap distance where the feature ends (the distance call is measured from here). */
  end: number
  direction?: 'left' | 'right'
  /** 1 (tightest) to 6 (flat out). */
  severity?: number
  modifiers: ClipKey[]
  /** How this note joins the next one: read together ('into' / 'and') or a distance call. */
  link: ClipKey | null
  calls: ClipKey[]
}

/** Corners start above this curvature and continue while above the exit value (hysteresis). */
const ENTER_CURVATURE = 1 / 130
const EXIT_CURVATURE = 1 / 180
const MERGE_GAP = 10
const MIN_SEGMENT = 10
const MIN_TURN = (12 * Math.PI) / 180
/** Minimum radius (m) for severities 1–5; anything wider is a 6. */
const SEVERITY_RADII = [15, 22, 32, 48, 75]
const DISTANCE_CALLS: [number, ClipKey][] = [
  [200, 'd200'],
  [150, 'd150'],
  [100, 'd100'],
  [80, 'd80'],
  [50, 'd50'],
  [28, 'd30'],
]
const INTO_GAP = 12
const AND_GAP = 28
const JUMP_LANDING = 16

type Corner = { start: number; end: number; sign: number }

function signedCurvature(track: Track): Float32Array {
  const n = track.count
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = track.sample(i - 3).tangent
    const b = track.sample(i + 3).tangent
    const left = track.sample(i).binormal
    raw[i] = ((b.x - a.x) * left.x + (b.z - a.z) * left.z) / (6 * track.spacing)
  }
  const radius = Math.max(1, Math.round(5 / track.spacing))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let o = -radius; o <= radius; o++) sum += raw[(i + o + n) % n]
    out[i] = sum / (radius * 2 + 1)
  }
  return out
}

function findCorners(k: Float32Array): Corner[] {
  const n = k.length
  // Start scanning on a straight so no corner wraps across the scan origin.
  let origin = 0
  for (let i = 0; i < n; i++) {
    if (Math.abs(k[i]) < EXIT_CURVATURE) {
      origin = i
      break
    }
  }

  const corners: Corner[] = []
  let current: Corner | null = null
  for (let s = 0; s < n; s++) {
    const i = origin + s
    const v = k[i % n]
    const sign = Math.sign(v)
    if (current && (Math.abs(v) < EXIT_CURVATURE || sign !== current.sign)) {
      current.end = i
      corners.push(current)
      current = null
    }
    if (!current && Math.abs(v) > ENTER_CURVATURE) current = { start: i, end: i, sign }
  }
  if (current) {
    current.end = origin + n
    corners.push(current)
  }

  const merged: Corner[] = []
  for (const c of corners) {
    const last = merged[merged.length - 1]
    if (last && last.sign === c.sign && c.start - last.end < MERGE_GAP) last.end = c.end
    else merged.push({ ...c })
  }
  return merged
}

function severityFor(radius: number): number {
  const i = SEVERITY_RADII.findIndex((r) => radius < r)
  return i === -1 ? 6 : i + 1
}

type Segment = { start: number; end: number; severity: number }

/**
 * Split one corner where its severity changes for a sustained stretch, so a hairpin inside a long
 * sweeper gets its own call instead of being averaged away.
 */
function segmentCorner(track: Track, k: Float32Array, c: Corner): Segment[] {
  const n = k.length
  const minLength = Math.round(MIN_SEGMENT / track.spacing)
  const runs: Segment[] = []
  for (let i = c.start; i < c.end; i++) {
    const severity = severityFor(1 / Math.max(Math.abs(k[i % n]), 1e-6))
    const last = runs[runs.length - 1]
    if (last && last.severity === severity) last.end = i + 1
    else runs.push({ start: i, end: i + 1, severity })
  }

  const len = (s: Segment) => s.end - s.start
  while (runs.length > 1) {
    let shortest = 0
    for (let i = 1; i < runs.length; i++) if (len(runs[i]) < len(runs[shortest])) shortest = i
    if (len(runs[shortest]) >= minLength) break
    const prev = runs[shortest - 1]
    const next = runs[shortest + 1]
    const target =
      !prev ? next : !next ? prev : Math.abs(prev.severity - runs[shortest].severity) <= Math.abs(next.severity - runs[shortest].severity) ? prev : next
    target.start = Math.min(target.start, runs[shortest].start)
    target.end = Math.max(target.end, runs[shortest].end)
    runs.splice(shortest, 1)
  }

  // Neighbours one step apart read as a single corner.
  const merged: Segment[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.severity - r.severity) <= 1) {
      last.severity = len(last) >= len(r) ? last.severity : r.severity
      last.end = r.end
    } else merged.push({ ...r })
  }
  return merged
}

function cornerNotes(track: Track, k: Float32Array, c: Corner): PaceNote[] {
  const n = k.length
  let turn = 0
  for (let i = c.start; i < c.end; i++) turn += Math.abs(k[i % n]) * track.spacing
  if (turn < MIN_TURN) return []

  const direction = c.sign > 0 ? 'left' : 'right'
  const notes: PaceNote[] = []
  const segments = segmentCorner(track, k, c)
  segments.forEach((seg, i) => {
    const next = segments[i + 1]
    const prev = notes[notes.length - 1]
    const distance = (seg.start % n) * track.spacing
    const length = (seg.end - seg.start) * track.spacing

    // A short, wider run after a tight one is the exit of the same corner.
    if (prev && seg.severity > prev.severity! && length < 30) {
      if (!prev.modifiers.includes('opens')) prev.modifiers.push('opens')
      prev.end += length
      return
    }

    const modifiers: ClipKey[] = []
    if (length > 55) modifiers.push('long')
    if (next && next.severity < seg.severity) modifiers.push('tightens')
    notes.push({ kind: 'corner', distance, end: distance + length, direction, severity: seg.severity, modifiers, link: null, calls: [] })
  })
  return notes
}

function distanceCall(gap: number): ClipKey | null {
  if (gap < INTO_GAP) return 'into'
  if (gap < AND_GAP) return 'and'
  return DISTANCE_CALLS.find(([d]) => gap >= d)![1]
}

/** Pace notes for one lap, in driving order, derived from the track's curvature and features. */
export function buildPaceNotes(track: Track): PaceNote[] {
  const k = signedCurvature(track)
  const notes: PaceNote[] = []
  for (const c of findCorners(k)) notes.push(...cornerNotes(track, k, c))

  const inCorner = (d: number) =>
    notes.find((c) => {
      const rel = (((d - c.distance) % track.length) + track.length) % track.length
      return rel <= c.end - c.distance + 4
    })

  for (const f of track.features) {
    const host = inCorner(f.distance)
    if (host) {
      host.modifiers.push(f.kind === 'crest' ? 'crest' : 'overJump')
      continue
    }
    notes.push({
      kind: f.kind,
      distance: f.distance - (f.kind === 'crest' ? 8 : 4),
      end: f.distance + (f.kind === 'jump' ? JUMP_LANDING : 6),
      modifiers: [],
      link: null,
      calls: [],
    })
  }

  for (let i = 0; i < track.count; i++) {
    const a = track.sample(i - 1).surface
    const b = track.sample(i).surface
    if (a === b) continue
    // A surface change mid-corner is called before that corner.
    const host = inCorner(track.sample(i).distance)
    const d = host ? host.distance - 1 : track.sample(i).distance
    notes.push({ kind: b, distance: d, end: d, modifiers: b === 'tarmac' ? ['walls'] : [], link: null, calls: [] })
  }

  notes.sort((a, b) => a.distance - b.distance)

  notes.forEach((note, i) => {
    const next = notes[(i + 1) % notes.length]
    const nextStart = next.distance + (i === notes.length - 1 ? track.length : 0)
    note.link = distanceCall(nextStart - note.end)

    if (note.kind === 'jump' && next.kind === 'corner' && next.severity! <= 3 && nextStart - note.end < 50) {
      note.modifiers.unshift('caution')
    }
  })

  for (const note of notes) note.calls = callsFor(note)
  return notes
}

function callsFor(note: PaceNote): ClipKey[] {
  const head: ClipKey[] =
    note.kind === 'corner'
      ? [`${note.direction!}${note.severity!}` as ClipKey]
      : note.kind === 'jump'
        ? ['jump']
        : note.kind === 'crest'
          ? ['crest']
          : [note.kind]
  const mods = note.kind === 'jump' ? note.modifiers.filter((m) => m !== 'caution') : note.modifiers
  const lead: ClipKey[] = note.modifiers.includes('caution') ? ['caution'] : []
  return [...lead, ...head, ...mods, ...(note.link ? [note.link] : [])]
}

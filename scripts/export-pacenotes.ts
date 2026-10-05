/**
 * Write every distinct pace-note phrase on the stage so the voice generator can render each one in a
 * single breath. Run through `npm run generate-codriver`.
 */
import { writeFileSync } from 'node:fs'
import { phraseKey } from '../src/game/audio/codriverClips'
import { buildPaceNotes } from '../src/game/audio/paceNotes'
import { Track } from '../src/game/track'

const notes = buildPaceNotes(new Track())
const phrases = [...new Set(notes.map((n) => phraseKey(n.calls)))]
const out = new URL('./pacenote-phrases.json', import.meta.url)
writeFileSync(out, JSON.stringify(phrases, null, 1) + '\n')
console.log(`${notes.length} notes, ${phrases.length} distinct phrases`)
for (const n of notes) console.log(`${n.distance.toFixed(0).padStart(4)} m  ${n.calls.join(' ')}`)

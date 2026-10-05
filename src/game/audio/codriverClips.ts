import lines from './codriverLines.json'
import type { ClipKey } from './paceNotes'

export type CodriverLanguage = 'zh' | 'en'

/** Sprite manifest written by scripts/generate-codriver.py: clip name -> [start, duration] in seconds. */
export type ClipManifest = { sampleRate: number; clips: Record<string, [number, number]> }

/** Whole pace notes are pre-rendered as one phrase under this key; single words use their own key. */
export function phraseKey(calls: readonly ClipKey[]): string {
  return calls.join('+')
}

export function phraseText(calls: readonly ClipKey[], lang: CodriverLanguage): string {
  return calls.map((c) => lines[c][lang]).join(lang === 'zh' ? '' : ' ')
}

export function lineText(key: ClipKey, lang: CodriverLanguage): string {
  return lines[key][lang]
}

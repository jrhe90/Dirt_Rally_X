const KEY = 'thrust-runner-v1'

export type SaveData = {
  best: number
  bestDistance: number
  cells: number
  runs: number
  muted: boolean
  music: boolean
  /** Tutorial hints already shown. */
  hints: string[]
}

const DEFAULTS: SaveData = { best: 0, bestDistance: 0, cells: 0, runs: 0, muted: false, music: true, hints: [] }

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SaveData>) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // Private mode or storage disabled: progress just isn't kept.
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern)
  } catch {
    // Not supported (iOS Safari).
  }
}

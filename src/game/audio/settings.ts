import type { CodriverLanguage } from './codriverClips'

export type CodriverSetting = CodriverLanguage | 'off'
export type AudioSettings = { codriver: CodriverSetting; music: boolean }

const KEY = 'kaltenbach-rally.audio'
const CODRIVER_OPTIONS: CodriverSetting[] = ['zh', 'en', 'off']

/** Saved choice, overridden by `?codriver=zh|en|off` and `?music=0|1`. */
export function loadAudioSettings(params: URLSearchParams): AudioSettings {
  let saved: Partial<AudioSettings> = {}
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    saved = {}
  }
  const codriverParam = params.get('codriver') as CodriverSetting | null
  const codriver = [codriverParam, saved.codriver].find((v) => v && CODRIVER_OPTIONS.includes(v)) ?? 'zh'
  const musicParam = params.get('music')
  const music = musicParam !== null ? musicParam !== '0' && musicParam !== 'off' : saved.music ?? true
  return { codriver, music }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Private mode: settings simply do not persist.
  }
}

export function nextCodriver(current: CodriverSetting): CodriverSetting {
  return CODRIVER_OPTIONS[(CODRIVER_OPTIONS.indexOf(current) + 1) % CODRIVER_OPTIONS.length]
}

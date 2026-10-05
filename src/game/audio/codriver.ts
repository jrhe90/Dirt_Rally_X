import type { Track } from '../track'
import { phraseKey, phraseText, type ClipManifest, type CodriverLanguage } from './codriverClips'
import type { AudioEngine } from './engine'
import { buildPaceNotes, finalLapCalls, type ClipKey, type PaceNote } from './paceNotes'

/** One thing the co-driver says, placed at an absolute stage distance (laps included). */
type Call = {
  at: number
  calls: ClipKey[]
  note: PaceNote | null
  /** Notes go stale once the car reaches them; lap and finish calls do not. */
  expires: boolean
}

export type SpokenCall = { note: PaceNote | null; calls: readonly ClipKey[] }

const MIN_LEAD = 45
const MAX_LEAD = 120
const LEAD_SECONDS = 2.3
/** Linked notes closer than this are read in one breath. */
const CHAIN_DISTANCE = 70
const PHRASE_GAP = 0.07
const WORD_GAP = 0.015
const SPEECH_LANG: Record<CodriverLanguage, string> = { zh: 'zh-CN', en: 'en-GB' }

type Voice = { manifest: ClipManifest; buffer: AudioBuffer }

/**
 * Reads pace notes ahead of the car, timed on distance and speed like a real co-driver, through
 * the engine's intercom bus. Falls back to the browser's speech synthesis if the clips fail to load.
 */
export class CoDriver {
  readonly notes: PaceNote[]
  private readonly engine: AudioEngine
  private readonly calls: Call[]
  private readonly voices = new Map<CodriverLanguage, Promise<Voice | null>>()
  private voice: Voice | null = null
  private lang: CodriverLanguage = 'zh'
  private enabled = true
  private next = 0
  private queue: Call[][] = []
  private speakingUntil = 0
  private sources: AudioBufferSourceNode[] = []
  private hiss: AudioBufferSourceNode | null = null
  private synthSpeaking = false
  private readonly onSpeak: (calls: SpokenCall[], lang: CodriverLanguage) => void

  constructor(engine: AudioEngine, track: Track, laps: number, onSpeak: (calls: SpokenCall[], lang: CodriverLanguage) => void) {
    this.engine = engine
    this.onSpeak = onSpeak
    this.notes = buildPaceNotes(track)
    const finish = track.length * laps
    const calls: Call[] = []
    for (let lap = 0; lap < laps; lap++) {
      this.notes.forEach((note, i) => {
        const last = lap === laps - 1 && i === this.notes.length - 1
        calls.push({ at: lap * track.length + note.distance, calls: last ? finalLapCalls(note) : note.calls, note, expires: true })
      })
      if (lap > 0) {
        calls.push({ at: lap * track.length - 20, calls: [lap === laps - 1 ? 'finalLap' : 'lap2'], note: null, expires: false })
      }
    }
    this.calls = calls.filter((c) => c.at < finish).sort((a, b) => a.at - b.at)
  }

  get language(): CodriverLanguage {
    return this.lang
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.silence()
  }

  /** Switch language; clips load in the background and speech synthesis covers the gap. */
  setLanguage(lang: CodriverLanguage): Promise<void> {
    this.lang = lang
    this.voice = null
    return this.load(lang).then((voice) => {
      if (this.lang === lang) this.voice = voice
    })
  }

  private load(lang: CodriverLanguage): Promise<Voice | null> {
    let pending = this.voices.get(lang)
    if (!pending) {
      const base = `${import.meta.env.BASE_URL}assets/audio/codriver-${lang}`
      pending = Promise.all([
        fetch(`${base}.json`).then((r) => (r.ok ? (r.json() as Promise<ClipManifest>) : Promise.reject(r.status))),
        fetch(`${base}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
          .then((data) => this.engine.ctx.decodeAudioData(data)),
      ])
        .then(([manifest, buffer]) => ({ manifest, buffer }))
        .catch((err) => {
          console.warn(`Co-driver clips for "${lang}" failed to load; using speech synthesis instead.`, err)
          return null
        })
      this.voices.set(lang, pending)
    }
    return pending
  }

  /** Forget what was said and pick up from the next note ahead of `progress`. */
  resync(progress: number): void {
    this.silence()
    this.next = this.calls.findIndex((c) => c.at > progress + 3)
    if (this.next === -1) this.next = this.calls.length
  }

  /** Say something right now, cutting off anything queued. */
  say(calls: ClipKey[]): void {
    if (!this.enabled) return
    this.silence()
    this.queue.push([{ at: 0, calls, note: null, expires: false }])
    this.pump(-Infinity)
  }

  update(progress: number, speed: number): void {
    const lead = Math.min(MAX_LEAD, Math.max(MIN_LEAD, 25 + speed * LEAD_SECONDS))
    if (!this.enabled) {
      // Keep the cursor moving so re-enabling does not replay old calls.
      while (this.next < this.calls.length && progress + lead >= this.calls[this.next].at) this.next++
      return
    }
    while (this.next < this.calls.length && progress + lead >= this.calls[this.next].at) {
      const call = this.calls[this.next++]
      const group = [call]
      let tail = call
      while (
        group.length < 2 &&
        this.next < this.calls.length &&
        (tail.note?.link === 'into' || tail.note?.link === 'and') &&
        this.calls[this.next].at - call.at < CHAIN_DISTANCE
      ) {
        tail = this.calls[this.next++]
        group.push(tail)
      }
      this.queue.push(group)
    }
    this.pump(progress)
  }

  private get speaking(): boolean {
    return this.synthSpeaking || this.engine.ctx.currentTime < this.speakingUntil
  }

  private pump(progress: number): void {
    if (this.speaking) return
    this.engine.duck(false)
    this.stopHiss()
    while (this.queue.length) {
      const group = this.queue.shift()!.filter((c) => !c.expires || progress < c.at - 2)
      if (group.length) {
        this.speak(group)
        return
      }
    }
  }

  private speak(group: Call[]): void {
    this.onSpeak(
      group.map((c) => ({ note: c.note, calls: c.calls })),
      this.lang,
    )
    if (!this.voice || !this.engine.running) {
      this.speakWithSynthesis(group)
      return
    }

    const { ctx } = this.engine
    const { manifest, buffer } = this.voice
    let t = ctx.currentTime + 0.03
    this.startHiss(t)
    for (const call of group) {
      const phrase = manifest.clips[phraseKey(call.calls)]
      const parts = phrase ? [phrase] : call.calls.map((k) => manifest.clips[k]).filter(Boolean)
      for (const [start, duration] of parts) {
        const src = ctx.createBufferSource()
        src.buffer = buffer
        src.connect(this.engine.voice)
        src.start(t, start, duration)
        this.sources.push(src)
        src.onended = () => {
          this.sources = this.sources.filter((s) => s !== src)
        }
        t += duration + (phrase ? 0 : WORD_GAP)
      }
      t += PHRASE_GAP
    }
    this.speakingUntil = t
    this.engine.duck(true)
  }

  private speakWithSynthesis(group: Call[]): void {
    const synth = window.speechSynthesis
    if (!synth) return
    const utterance = new SpeechSynthesisUtterance(group.map((c) => phraseText(c.calls, this.lang)).join(this.lang === 'zh' ? '，' : ', '))
    utterance.lang = SPEECH_LANG[this.lang]
    utterance.rate = 1.35
    utterance.onend = utterance.onerror = () => {
      this.synthSpeaking = false
    }
    this.synthSpeaking = true
    this.engine.duck(true)
    synth.speak(utterance)
  }

  /** Faint open-mic noise under the voice, like a helmet intercom. */
  private startHiss(t: number): void {
    const { ctx } = this.engine
    this.stopHiss()
    const src = ctx.createBufferSource()
    src.buffer = this.engine.noise
    src.loop = true
    const g = ctx.createGain()
    g.gain.value = 0.018
    src.connect(g).connect(this.engine.voice)
    src.start(t)
    this.hiss = src
  }

  private stopHiss(): void {
    if (!this.hiss) return
    this.hiss.stop(this.engine.ctx.currentTime + 0.12)
    this.hiss = null
  }

  private silence(): void {
    this.queue = []
    for (const src of this.sources) src.stop()
    this.sources = []
    this.speakingUntil = 0
    this.stopHiss()
    if (this.synthSpeaking) window.speechSynthesis?.cancel()
    this.synthSpeaking = false
    this.engine.duck(false)
  }
}

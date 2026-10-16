/** mulberry32 with its state kept in the sim, so cloning the sim clones the random stream. */
export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function randomRange(state: { rng: number }, min: number, max: number): number {
  return min + (max - min) * nextRandom(state)
}

export function randomInt(state: { rng: number }, min: number, maxInclusive: number): number {
  return min + Math.floor(nextRandom(state) * (maxInclusive - min + 1))
}

export function pick<T>(state: { rng: number }, items: readonly T[]): T {
  return items[Math.floor(nextRandom(state) * items.length)]
}

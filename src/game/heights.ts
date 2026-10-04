export const WORLD_HALF_SIZE = 200
const RIM_START = 168

/** Rolling hills with a raised rim that frames the stage. */
export function naturalHeight(x: number, z: number): number {
  const hills =
    Math.sin(x * 0.018) * 4 +
    Math.cos(z * 0.015) * 3.5 +
    Math.sin((x + z) * 0.011) * 5 +
    Math.sin(x * 0.05 + z * 0.035) * 1.2 +
    Math.cos(x * 0.07 - z * 0.06) * 0.6
  const rim = Math.max(0, Math.hypot(x, z) - RIM_START)
  return hills + Math.min(rim * rim * 0.012, 32)
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

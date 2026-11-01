import type { Body } from './types'

/**
 * Separating-axis test for two oriented rectangles in (s, d). Returns the penetration depth and
 * the push direction for `b` (unit vector in s, d), or null when they do not touch.
 */
export function overlap(a: Body, b: Body, inflate = 0): { depth: number; ns: number; nd: number } | null {
  const axes = [a.psi, a.psi + Math.PI / 2, b.psi, b.psi + Math.PI / 2]
  let best = Infinity
  let bs = 0
  let bd = 0
  const cs = b.s - a.s
  const cd = b.d - a.d
  for (const ang of axes) {
    const us = Math.cos(ang)
    const ud = Math.sin(ang)
    const ra = halfExtent(a, us, ud) + inflate
    const rb = halfExtent(b, us, ud) + inflate
    const dist = cs * us + cd * ud
    const pen = ra + rb - Math.abs(dist)
    if (pen <= 0) return null
    if (pen < best) {
      best = pen
      const sign = dist >= 0 ? 1 : -1
      bs = us * sign
      bd = ud * sign
    }
  }
  return { depth: best, ns: bs, nd: bd }
}

/** Projection radius of a body's rectangle onto the axis (us, ud). */
export function halfExtent(b: Body, us: number, ud: number): number {
  const fs = Math.cos(b.psi)
  const fd = Math.sin(b.psi)
  return (b.length / 2) * Math.abs(fs * us + fd * ud) + (b.width / 2) * Math.abs(-fd * us + fs * ud)
}

/** Lateral half-extent of a body (for lane occupancy). */
export function halfWidthD(b: Body): number {
  return halfExtent(b, 0, 1)
}

export function halfLengthS(b: Body): number {
  return halfExtent(b, 1, 0)
}

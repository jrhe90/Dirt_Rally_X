import { nextRandom } from '../../flyer/sim/rng'

/**
 * An endless coastal highway, generated ahead of the car on demand. The centerline is built
 * from its curvature: straights and constant-radius sweepers joined by clothoid transitions
 * (curvature ramps linearly), integrated into heading and position every 2 m. The overall
 * heading is kept within ±60° of +x, so the road never loops back on itself and the ocean
 * stays on the right. Elevation is a sum of slow sines.
 *
 * Heading `psi` is a Three.js yaw: forward is (cos psi, -sin psi) in (x, z), left is
 * (-sin psi, -cos psi), and positive curvature turns left.
 */

const DS = 2
const HEADING_LIMIT = 1.05

export type RoadPoint = { x: number; y: number; z: number; psi: number; kappa: number }

export class Road {
  private readonly psi: number[] = [0]
  private readonly x: number[] = [0]
  private readonly z: number[] = [0]
  /** Curvature knots (s, kappa), piecewise linear. */
  private readonly knotS: number[] = [0, 420]
  private readonly knotK: number[] = [0, 0]
  private readonly state: { rng: number }
  private readonly phase: [number, number, number]
  private knotCursor = 0

  constructor(seed: number) {
    this.state = { rng: seed ^ 0x51ed27 }
    this.phase = [nextRandom(this.state) * 6.28, nextRandom(this.state) * 6.28, nextRandom(this.state) * 6.28]
  }

  get length(): number {
    return (this.psi.length - 1) * DS
  }

  private rand(min: number, max: number): number {
    return min + (max - min) * nextRandom(this.state)
  }

  private addSegment(): void {
    const s0 = this.knotS[this.knotS.length - 1]
    const k0 = this.knotK[this.knotK.length - 1]
    const heading = this.psi[this.psi.length - 1]
    let k: number
    if (k0 !== 0 || nextRandom(this.state) < 0.3) {
      k = 0
    } else {
      const radius = this.rand(420, 1500)
      let sign = nextRandom(this.state) < 0.5 ? 1 : -1
      // Steer back toward +x when the heading strays.
      if (heading > HEADING_LIMIT * 0.45) sign = -1
      else if (heading < -HEADING_LIMIT * 0.45) sign = 1
      k = sign / radius
    }
    const transition = this.rand(130, 240)
    const hold = k === 0 ? this.rand(180, 700) : this.rand(150, 520)
    this.knotS.push(s0 + transition, s0 + transition + hold)
    this.knotK.push(k, k)
  }

  /** Curvature at s, from the knots (which always run ahead of the integrated samples). */
  private knotKappa(s: number): number {
    while (this.knotCursor > 0 && this.knotS[this.knotCursor] > s) this.knotCursor--
    while (this.knotCursor < this.knotS.length - 2 && this.knotS[this.knotCursor + 1] <= s) this.knotCursor++
    const i = this.knotCursor
    const s0 = this.knotS[i]
    const s1 = this.knotS[i + 1]
    const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0)))
    return this.knotK[i] + (this.knotK[i + 1] - this.knotK[i]) * t
  }

  /** Generate samples up to at least s. */
  ensure(s: number): void {
    while (this.length < s) {
      const i = this.psi.length - 1
      const sMid = i * DS + DS / 2
      while (this.knotS[this.knotS.length - 1] < sMid + DS) this.addSegment()
      // Clamp the curvature if the heading has hit its limit.
      let k = this.knotKappa(sMid)
      const h = this.psi[i]
      if ((h > HEADING_LIMIT && k > 0) || (h < -HEADING_LIMIT && k < 0)) k = 0
      const psiMid = h + k * DS * 0.5
      this.psi.push(h + k * DS)
      this.x.push(this.x[i] + Math.cos(psiMid) * DS)
      this.z.push(this.z[i] - Math.sin(psiMid) * DS)
    }
  }

  kappa(s: number): number {
    this.ensure(s + DS * 2)
    const f = Math.max(0, s) / DS
    const i = Math.floor(f)
    return (this.psi[i + 1] - this.psi[i]) / DS
  }

  heading(s: number): number {
    this.ensure(s + DS * 2)
    const f = Math.max(0, s) / DS
    const i = Math.floor(f)
    const t = f - i
    return this.psi[i] + (this.psi[i + 1] - this.psi[i]) * t
  }

  elevation(s: number): number {
    const [a, b, c] = this.phase
    const tau = Math.PI * 2
    return 16 + 7 * Math.sin((tau * s) / 1900 + a) + 3.2 * Math.sin((tau * s) / 820 + b) + 0.7 * Math.sin((tau * s) / 330 + c)
  }

  grade(s: number): number {
    return (this.elevation(s + 1) - this.elevation(s - 1)) / 2
  }

  /** World position of Frenet (s, d). */
  point(s: number, d: number, out: RoadPoint = { x: 0, y: 0, z: 0, psi: 0, kappa: 0 }): RoadPoint {
    this.ensure(s + DS * 2)
    const f = Math.max(0, s) / DS
    const i = Math.floor(f)
    const t = f - i
    const psi = this.psi[i] + (this.psi[i + 1] - this.psi[i]) * t
    // Interpolate along the arc using the midpoint heading for accuracy on curves.
    const ds = t * DS
    const pm = this.psi[i] + (psi - this.psi[i]) * 0.5
    const cx = this.x[i] + Math.cos(pm) * ds
    const cz = this.z[i] - Math.sin(pm) * ds
    out.x = cx - Math.sin(psi) * d
    out.z = cz - Math.cos(psi) * d
    out.y = this.elevation(s)
    out.psi = psi
    out.kappa = (this.psi[i + 1] - this.psi[i]) / DS
    return out
  }
}

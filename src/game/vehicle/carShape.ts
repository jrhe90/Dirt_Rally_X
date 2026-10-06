import * as THREE from 'three'
import { CAR } from './config'

/**
 * Body shapes in car-local meters: x left, y up, z forward, origin at the
 * physics body's center. The ground sits about 0.63 m below the origin at rest.
 */

export const BODY = {
  front: 2.03,
  rear: -2.0,
  wheelY: -0.29,
  archRadius: 0.42,
  wheelWell: 0.56,
}

export type BodyStyle = {
  kind: 'hatch' | 'coupe'
  /** Side silhouette (z, y) from the front bumper to the rear. */
  top: [number, number][]
  /** Rearmost z of the side windows, and the B-pillar's z. */
  sideGlassRear: number
  bPillar: number
  /** z ranges of the windscreen and rear screen as seen from above. */
  windscreen: [number, number]
  rearScreen: [number, number]
  /** Top of the windscreen as seen head-on. */
  windscreenTop: number
}

const HATCH_TOP: [number, number][] = [
  [2.03, -0.02],
  [1.99, 0.09],
  [1.88, 0.165],
  [1.55, 0.225],
  [1.15, 0.27],
  [0.8, 0.305],
  [0.55, 0.45],
  [0.25, 0.66],
  [-0.02, 0.775],
  [-0.4, 0.83],
  [-1.0, 0.83],
  [-1.4, 0.805],
  [-1.6, 0.72],
  [-1.76, 0.52],
  [-1.89, 0.33],
  [-1.97, 0.16],
  [-2.0, 0.0],
]

/** Rear-engined fastback: low sloping bonnet, short glasshouse and a long tapering tail. */
const COUPE_TOP: [number, number][] = [
  [2.03, -0.06],
  [1.99, 0.05],
  [1.88, 0.12],
  [1.6, 0.18],
  [1.2, 0.235],
  [0.85, 0.28],
  [0.6, 0.39],
  [0.35, 0.53],
  [0.08, 0.66],
  [-0.25, 0.71],
  [-0.55, 0.69],
  [-0.85, 0.61],
  [-1.2, 0.49],
  [-1.55, 0.39],
  [-1.8, 0.33],
  [-1.93, 0.28],
  [-1.99, 0.18],
  [-2.0, 0.02],
]

export const BODY_STYLES: Record<BodyStyle['kind'], BodyStyle> = {
  hatch: {
    kind: 'hatch',
    top: HATCH_TOP,
    sideGlassRear: -1.6,
    bPillar: -0.7,
    windscreen: [0.04, 0.74],
    rearScreen: [-1.85, -1.56],
    windscreenTop: 0.76,
  },
  coupe: {
    kind: 'coupe',
    top: COUPE_TOP,
    sideGlassRear: -1.0,
    bPillar: -0.62,
    windscreen: [0.12, 0.6],
    rearScreen: [-1.15, -0.62],
    windscreenTop: 0.64,
  },
}

let style = BODY_STYLES.hatch
let topTable = buildTopTable(style.top)

function buildTopTable(points: [number, number][]): { z: number; y: number }[] {
  const curve = new THREE.SplineCurve(points.map(([z, y]) => new THREE.Vector2(z, y)))
  return curve
    .getPoints(600)
    .map((p) => ({ z: p.x, y: p.y }))
    .sort((a, b) => a.z - b.z)
}

export function bodyStyle(): BodyStyle {
  return style
}

/** Switches the shape every function below describes; rebuild the car model afterwards. */
export function setBodyStyle(next: BodyStyle): void {
  if (next === style) return
  style = next
  topTable = buildTopTable(next.top)
}

/** Upper silhouette (bonnet, windscreen, roof, hatch) seen from the side. */
export function topY(z: number): number {
  const t = topTable
  if (z <= t[0].z) return t[0].y
  if (z >= t[t.length - 1].z) return t[t.length - 1].y
  let lo = 0
  let hi = t.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t[mid].z < z) lo = mid
    else hi = mid
  }
  const f = (z - t[lo].z) / Math.max(1e-6, t[hi].z - t[lo].z)
  return t[lo].y + (t[hi].y - t[lo].y) * f
}

export function bottomY(z: number): number {
  if (z > 1.72) return -0.4 + 0.12 * ((z - 1.72) / 0.31) ** 2
  if (z < -1.75) return -0.4 + 0.1 * ((-1.75 - z) / 0.25) ** 2
  return -0.4
}

export function beltY(z: number): number {
  return THREE.MathUtils.clamp(0.315 + (0.8 - z) * 0.028, 0.3, 0.38)
}

function bell(z: number, center: number, width: number): number {
  const d = Math.abs(z - center) / width
  return d >= 1 ? 0 : Math.cos(d * Math.PI * 0.5) ** 2
}

export function halfWidthAt(z: number): number {
  let hw = 0.86
  hw += 0.075 * bell(z, CAR.frontAxle, 0.62) + 0.075 * bell(z, CAR.rearAxle, 0.62)
  if (z > 1.45) hw -= 0.17 * ((z - 1.45) / 0.58) ** 2
  if (z < -1.55) hw -= 0.13 * ((-1.55 - z) / 0.45) ** 2
  return hw
}

/** Height of the wheel-arch opening's upper edge at z, or the sill height outside the arches. */
export function archY(z: number): number {
  const bottom = bottomY(z)
  for (const cz of [CAR.frontAxle, CAR.rearAxle]) {
    const d = Math.abs(z - cz)
    if (d < BODY.archRadius) return Math.max(bottom, BODY.wheelY + Math.sqrt(BODY.archRadius ** 2 - d * d))
  }
  return bottom
}

/** 0 where the roofline is just bonnet or bumper, 1 across the glasshouse. */
export function cabinFactor(z: number): number {
  return THREE.MathUtils.smoothstep(topY(z) - beltY(z), 0.04, 0.22)
}

/** Half cross-section from bottom center to top center (12 points). */
export function halfSection(z: number): [number, number][] {
  const hw = halfWidthAt(z)
  const yBot = bottomY(z)
  const yTop = topY(z)
  const yA = archY(z)
  const yF1 = Math.min(beltY(z), yTop - 0.04)
  const g = Math.max(0, yTop - yF1)
  const c = cabinFactor(z)
  const roofHw = THREE.MathUtils.lerp(hw - 0.12, hw * 0.71, c)
  const xIn = Math.min(BODY.wheelWell, hw - 0.12)
  const flank0 = Math.min(yA + 0.05, yF1 - 0.06)

  return [
    [0, yBot],
    [xIn, yBot],
    [xIn, yA],
    [hw - 0.05, yA],
    [hw - 0.006, flank0],
    [hw, THREE.MathUtils.lerp(flank0, yF1, 0.5)],
    [hw - 0.012, yF1 - 0.02],
    [hw - 0.045, yF1 + 0.006],
    [THREE.MathUtils.lerp(hw - 0.045, roofHw, 0.55) + 0.01 * c, yF1 + g * 0.55],
    [roofHw + 0.035, yTop - 0.028],
    [roofHw - 0.09, yTop - 0.002],
    [0, yTop + 0.012],
  ]
}

/** Loft stations along z, denser where the arches open so the opening edge stays crisp. */
export function stations(): number[] {
  const zs: number[] = []
  for (let z = BODY.rear; z <= BODY.front + 1e-6; z += 0.04) zs.push(Math.min(z, BODY.front))
  for (const cz of [CAR.frontAxle, CAR.rearAxle]) {
    for (const s of [-1, 1]) {
      const edge = cz + s * BODY.archRadius
      zs.push(edge - s * 0.003, edge + s * 0.003)
    }
    for (let a = -0.95; a <= 0.95; a += 0.1) zs.push(cz + a * BODY.archRadius)
  }
  if (zs[zs.length - 1] !== BODY.front) zs.push(BODY.front)
  return [...new Set(zs.map((z) => Math.round(z * 10000) / 10000))].sort((a, b) => a - b)
}

import * as THREE from 'three'
import { CAR } from './config'
import { BODY, beltY, halfWidthAt, topY } from './carShape'

/**
 * Livery atlas, 2048 x 2048, painted in car-local meters. The body shader projects it in object
 * space, so these region mappings must match `LIVERY_GLSL` in carModel.ts.
 *
 *   right side (-x)  rows    0..512    px = (z + 2.1) / 4.2 * 2048   py = (0.9 - y) / 1.4 * 512
 *   left side (+x)   rows  512..1024   px = (2.1 - z) / 4.2 * 2048
 *   top              rows 1024..1536   px = (z + 2.1) / 4.2 * 2048   py = (1 - x) / 2 * 512
 *   front            cols    0..1024, rows 1536..2048   px = (x + 1) / 2 * 1024
 *   rear             cols 1024..2048, rows 1536..2048   px = (1 - x) / 2 * 1024
 */

const SIZE = 2048
const SIDE_SX = SIZE / 4.2
const SIDE_SY = 512 / 1.4

const WHITE = '#f2f2ef'
const BLACK = '#121315'
const BLUE = '#1b56f0'
const DEEP = '#0b2a8a'
const YELLOW = '#e4ff1c'
const CYAN = '#14d8c4'
const GLASS = '#0a0e12'

type Region = {
  /** Car meters to canvas pixels. */
  map: (a: number, b: number) => [number, number]
  /** Horizontal and vertical pixels per meter, signed. */
  sx: number
  sy: number
  ox: number
  oy: number
}

const regions = {
  right: region(SIDE_SX, -SIDE_SY, 2.1 * SIDE_SX, 0.9 * SIDE_SY),
  left: region(-SIDE_SX, -SIDE_SY, 2.1 * SIDE_SX, 512 + 0.9 * SIDE_SY),
  top: region(SIDE_SX, -256, 2.1 * SIDE_SX, 1024 + 256),
  front: region(512, -SIDE_SY, 512, 1536 + 0.9 * SIDE_SY),
  rear: region(-512, -SIDE_SY, 1024 + 512, 1536 + 0.9 * SIDE_SY),
}

function region(sx: number, sy: number, ox: number, oy: number): Region {
  return { sx, sy, ox, oy, map: (a, b) => [ox + a * sx, oy + b * sy] }
}

type Painter = {
  ctx: CanvasRenderingContext2D
  mask: CanvasRenderingContext2D
}

export type Livery = { color: THREE.CanvasTexture; mask: THREE.CanvasTexture; dirt: THREE.CanvasTexture }

export function createLivery(): Livery {
  const color = makeCanvas(SIZE)
  const mask = makeCanvas(SIZE)
  const p: Painter = { ctx: color.getContext('2d')!, mask: mask.getContext('2d')! }
  p.ctx.fillStyle = WHITE
  p.ctx.fillRect(0, 0, SIZE, SIZE)
  p.mask.fillStyle = '#000'
  p.mask.fillRect(0, 0, SIZE, SIZE)

  paintSide(p, regions.right)
  paintSide(p, regions.left)
  paintTop(p, regions.top)
  paintFront(p, regions.front)
  paintRear(p, regions.rear)

  const colorTex = new THREE.CanvasTexture(color)
  colorTex.colorSpace = THREE.SRGBColorSpace
  colorTex.anisotropy = 8
  const maskTex = new THREE.CanvasTexture(mask)
  maskTex.anisotropy = 8
  return { color: colorTex, mask: maskTex, dirt: createDirtTexture() }
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return c
}

/** Draw in region meters on both color and mask canvases. */
function inMeters(ctx: CanvasRenderingContext2D, r: Region, draw: () => void) {
  ctx.save()
  ctx.setTransform(r.sx, 0, 0, r.sy, r.ox, r.oy)
  draw()
  ctx.restore()
}

function poly(ctx: CanvasRenderingContext2D, r: Region, pts: [number, number][], fill: string) {
  inMeters(ctx, r, () => {
    ctx.fillStyle = fill
    ctx.beginPath()
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)))
    ctx.closePath()
    ctx.fill()
  })
}

function rect(ctx: CanvasRenderingContext2D, r: Region, a0: number, b0: number, a1: number, b1: number, fill: string) {
  poly(ctx, r, [[a0, b0], [a1, b0], [a1, b1], [a0, b1]], fill)
}

/** Readable (never mirrored) text centered at region coordinates, `height` in meters. */
function text(
  ctx: CanvasRenderingContext2D,
  r: Region,
  str: string,
  a: number,
  b: number,
  height: number,
  fill: string,
  font = '"Bebas Neue", Impact, sans-serif',
  weight = 'bold',
  italic = true,
) {
  const [px, py] = r.map(a, b)
  ctx.save()
  ctx.setTransform(Math.abs(r.sx) / Math.abs(r.sy), 0, italic ? -0.18 : 0, 1, px, py)
  ctx.fillStyle = fill
  ctx.font = `${weight} ${Math.round(height * Math.abs(r.sy))}px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(str, 0, 0)
  ctx.restore()
}

function sampled(from: number, to: number, steps: number, f: (z: number) => [number, number]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= steps; i++) out.push(f(from + ((to - from) * i) / steps))
  return out
}

function paintSide({ ctx, mask }: Painter, r: Region) {
  // Lower body in black with an electric-blue wedge sweeping up to the rear.
  poly(ctx, r, [[2.2, -0.6], [2.2, -0.06], [0.7, -0.13], [-0.6, -0.06], [-2.2, 0.2], [-2.2, -0.6]], BLACK)
  poly(ctx, r, [[2.2, -0.06], [0.7, -0.13], [-0.6, -0.06], [-2.2, 0.2], [-2.2, 0.44], [-0.4, 0.07], [0.9, -0.03], [2.2, 0.02]], BLUE)
  poly(ctx, r, [[-0.2, 0.0], [-2.2, 0.33], [-2.2, 0.44], [-0.4, 0.07]], DEEP)
  inMeters(ctx, r, () => {
    ctx.strokeStyle = YELLOW
    ctx.lineWidth = 0.035
    ctx.beginPath()
    ctx.moveTo(2.2, 0.035)
    ctx.lineTo(0.9, -0.0)
    ctx.lineTo(-0.4, 0.1)
    ctx.lineTo(-2.2, 0.48)
    ctx.stroke()
  })
  // Shards on the rear quarter.
  poly(ctx, r, [[-1.05, 0.13], [-1.55, 0.3], [-1.3, 0.12]], CYAN)
  poly(ctx, r, [[-1.4, 0.06], [-1.95, 0.2], [-1.7, 0.03]], YELLOW)
  poly(ctx, r, [[-0.75, 0.1], [-1.1, 0.24], [-0.95, 0.09]], WHITE)

  // Black arch trims and sills (matte plastic).
  for (const target of [ctx, mask]) {
    const fill = target === mask ? '#00ff00' : '#18191b'
    inMeters(target, r, () => {
      target.strokeStyle = fill
      target.lineWidth = 0.06
      for (const cz of [CAR.frontAxle, CAR.rearAxle]) {
        target.beginPath()
        target.arc(cz, BODY.wheelY, BODY.archRadius + 0.025, 0, Math.PI * 2)
        target.stroke()
      }
    })
    rect(target, r, -2.2, -0.6, 2.2, -0.345, fill)
  }

  // Door shut lines and handle.
  inMeters(ctx, r, () => {
    ctx.strokeStyle = 'rgba(10,10,12,0.75)'
    ctx.lineWidth = 0.006
    ctx.beginPath()
    ctx.moveTo(0.66, -0.36)
    ctx.lineTo(0.66, beltY(0.66))
    ctx.moveTo(-0.72, -0.36)
    ctx.lineTo(-0.72, beltY(-0.72))
    ctx.moveTo(0.66, -0.36)
    ctx.lineTo(-0.72, -0.36)
    ctx.stroke()
  })
  rect(ctx, r, -0.5, 0.255, -0.62, 0.285, '#1a1a1c')

  // Door number plate and sponsors.
  inMeters(ctx, r, () => {
    ctx.fillStyle = WHITE
    ctx.strokeStyle = BLACK
    ctx.lineWidth = 0.012
    ctx.beginPath()
    ctx.roundRect(-0.12, -0.02, 0.44, 0.27, 0.04)
    ctx.fill()
    ctx.stroke()
  })
  text(ctx, r, '27', 0.1, 0.11, 0.24, BLACK, '"Bebas Neue", Impact, sans-serif', 'bold', false)
  text(ctx, r, 'KESTREL', 0.0, -0.22, 0.17, WHITE)
  text(ctx, r, 'VOLTA ENERGY', -1.45, 0.06, 0.07, WHITE)
  text(ctx, r, 'RIDGELINE', 1.3, 0.2, 0.055, BLACK)
  text(ctx, r, 'RIDGELINE', -1.2, -0.34 + 0.1, 0.05, YELLOW)

  // Glasshouse: side glass with black seals, B-pillar and crew names.
  const windowTop = (z: number) => topY(z) - 0.065
  const windowBottom = (z: number) => beltY(z) + 0.022
  let zFront = 0.75
  while (zFront > 0 && windowTop(zFront) - windowBottom(zFront) < 0.02) zFront -= 0.01
  const zRear = -1.6
  const glass: [number, number][] = [
    ...sampled(zFront, zRear, 40, (z) => [z, windowBottom(z)]),
    ...sampled(zRear, zFront, 40, (z) => [z, windowTop(z)]),
  ]
  for (const target of [ctx, mask]) {
    poly(target, r, glass, target === mask ? '#ff0000' : GLASS)
    inMeters(target, r, () => {
      target.strokeStyle = target === mask ? '#00ff00' : '#0c0c0e'
      target.lineWidth = 0.022
      target.beginPath()
      glass.forEach(([a, b], i) => (i ? target.lineTo(a, b) : target.moveTo(a, b)))
      target.closePath()
      target.stroke()
    })
    rect(target, r, -0.66, windowBottom(-0.66) - 0.01, -0.75, windowTop(-0.7) + 0.01, target === mask ? '#00ff00' : '#111214')
  }
  text(ctx, r, 'J. ROSS  ·  M. HALE', -1.1, windowBottom(-1.1) + 0.06, 0.045, WHITE, 'Arial, sans-serif', 'bold', false)

  // Lamp corners seen from the side.
  for (const target of [ctx, mask]) {
    poly(target, r, [[1.72, 0.17], [2.0, 0.1], [2.03, 0.04], [1.85, 0.07]], target === mask ? '#ff0000' : '#2a3138')
    rect(target, r, -1.99, 0.18, -1.9, 0.48, target === mask ? '#ff0000' : '#a8121a')
  }
}

function paintTop({ ctx, mask }: Painter, r: Region) {
  // Bonnet: blue chevron with a yellow pinstripe.
  poly(ctx, r, [[0.8, -0.6], [2.2, -0.3], [2.2, 0.3], [0.8, 0.6], [0.8, 0.42], [1.9, 0.16], [1.9, -0.16], [0.8, -0.42]], BLUE)
  inMeters(ctx, r, () => {
    ctx.strokeStyle = YELLOW
    ctx.lineWidth = 0.03
    ctx.beginPath()
    ctx.moveTo(0.8, 0.44)
    ctx.lineTo(1.9, 0.18)
    ctx.lineTo(1.9, -0.18)
    ctx.lineTo(0.8, -0.44)
    ctx.stroke()
  })
  text(ctx, r, 'KESTREL', 1.32, 0, 0.16, BLACK)
  for (const target of [ctx, mask]) {
    for (const x of [-0.3, 0.3]) rect(target, r, 1.05, x - 0.1, 1.3, x + 0.1, target === mask ? '#00ff00' : '#151517')
  }

  // Roof: deep blue with the competition number for the helicopter camera.
  rect(ctx, r, -1.5, -1, -0.05, 1, DEEP)
  inMeters(ctx, r, () => {
    ctx.fillStyle = WHITE
    ctx.beginPath()
    ctx.roundRect(-1.12, -0.28, 0.6, 0.56, 0.06)
    ctx.fill()
  })
  text(ctx, r, '27', -0.82, 0, 0.5, BLACK, '"Bebas Neue", Impact, sans-serif', 'bold', false)

  // Lower body below the sills and the sides of the bumpers stay black.
  rect(ctx, r, -2.2, -1, 2.2, -0.86, BLACK)
  rect(ctx, r, -2.2, 0.86, 2.2, 1, BLACK)

  // Windscreen and rear screen.
  const screen = (z0: number, z1: number) => {
    const pts: [number, number][] = [
      ...sampled(z0, z1, 12, (z) => [z, halfWidthAt(z) * 0.7 - 0.02] as [number, number]),
      ...sampled(z1, z0, 12, (z) => [z, -(halfWidthAt(z) * 0.7 - 0.02)] as [number, number]),
    ]
    for (const target of [ctx, mask]) poly(target, r, pts, target === mask ? '#ff0000' : GLASS)
  }
  screen(0.04, 0.74)
  screen(-1.85, -1.56)
  rect(ctx, r, 0.04, -0.62, 0.15, 0.62, BLUE)
  text(ctx, r, 'KALTENBACH RALLY', 0.095, 0, 0.07, WHITE, '"Bebas Neue", Impact, sans-serif', 'bold', false)
}

function paintFront({ ctx, mask }: Painter, r: Region) {
  rect(ctx, r, -1, 0.0, 1, 0.3, WHITE)
  poly(ctx, r, [[-1, 0.02], [1, 0.02], [1, 0.12], [0.4, 0.18], [-0.4, 0.18], [-1, 0.12]], BLUE)
  for (const target of [ctx, mask]) {
    const matte = target === mask ? '#00ff00' : '#141416'
    rect(target, r, -1, -0.6, 1, 0.0, matte)
  }
  // Honeycomb grille.
  inMeters(ctx, r, () => {
    ctx.fillStyle = '#060607'
    ctx.beginPath()
    ctx.moveTo(-0.5, -0.03)
    ctx.lineTo(0.5, -0.03)
    ctx.lineTo(0.42, -0.3)
    ctx.lineTo(-0.42, -0.3)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#2a2b2e'
    ctx.lineWidth = 0.005
    for (let x = -0.5; x <= 0.5; x += 0.035) {
      for (let y = -0.3; y <= -0.03; y += 0.03) {
        ctx.beginPath()
        ctx.arc(x + ((Math.round(y / 0.03) % 2) * 0.0175), y, 0.012, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  })
  // Fog lamps and plate.
  for (const target of [ctx, mask]) {
    for (const x of [-0.6, 0.6]) {
      inMeters(target, r, () => {
        target.fillStyle = target === mask ? '#0000ff' : '#d8d4c0'
        target.beginPath()
        target.arc(x, -0.2, 0.065, 0, Math.PI * 2)
        target.fill()
      })
    }
  }
  rect(ctx, r, -0.22, -0.2, 0.22, -0.1, WHITE)
  text(ctx, r, 'KR 27', 0, -0.15, 0.075, BLACK, 'Arial, sans-serif', 'bold', false)
  // Headlamps.
  for (const target of [ctx, mask]) {
    for (const s of [-1, 1]) {
      poly(target, r, [[s * 0.32, 0.1], [s * 0.74, 0.07], [s * 0.78, 0.16], [s * 0.42, 0.17]], target === mask ? '#ff00ff' : '#30363c')
    }
  }
  // Windscreen as seen head-on.
  for (const target of [ctx, mask]) {
    poly(target, r, [[-0.66, 0.34], [0.66, 0.34], [0.58, 0.76], [-0.58, 0.76]], target === mask ? '#ff0000' : GLASS)
  }
  rect(ctx, r, -0.6, 0.68, 0.6, 0.76, BLUE)
}

function paintRear({ ctx, mask }: Painter, r: Region) {
  rect(ctx, r, -1, 0.0, 1, 0.9, WHITE)
  poly(ctx, r, [[-1, 0.0], [1, 0.0], [1, 0.12], [-1, 0.24]], BLUE)
  for (const target of [ctx, mask]) rect(target, r, -1, -0.6, 1, 0.0, target === mask ? '#00ff00' : '#141416')
  for (const target of [ctx, mask]) {
    poly(target, r, [[-0.56, 0.44], [0.56, 0.44], [0.5, 0.74], [-0.5, 0.74]], target === mask ? '#ff0000' : GLASS)
    for (const s of [-1, 1]) {
      poly(target, r, [[s * 0.62, 0.14], [s * 0.82, 0.16], [s * 0.8, 0.5], [s * 0.66, 0.48]], target === mask ? '#ff0000' : '#a0101a')
    }
  }
  text(ctx, r, 'KESTREL RALLY TEAM', 0, 0.3, 0.07, BLACK)
  rect(ctx, r, -0.22, -0.02, 0.22, 0.09, WHITE)
  text(ctx, r, 'KR 27', 0, 0.035, 0.07, BLACK, 'Arial, sans-serif', 'bold', false)
}

function createDirtTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#404040'
  ctx.fillRect(0, 0, size, size)
  let seed = 3
  const rng = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < 2600; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = 2 + rng() ** 3 * 34
    const v = Math.floor(90 + rng() * 165)
    ctx.fillStyle = `rgba(${v},${v},${v},${0.08 + rng() * 0.2})`
    for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.beginPath()
      ctx.ellipse(x + dx, y + dy, r, r * (0.4 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

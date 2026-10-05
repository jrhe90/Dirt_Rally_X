import * as THREE from 'three'
import { CAR } from './config'
import { createLivery } from './carLivery'
import { BODY, halfSection, stations, topY } from './carShape'
import type { Vehicle } from './vehicle'

/** Must match the atlas layout documented in carLivery.ts. */
const LIVERY_GLSL = /* glsl */ `
  vec3 on = normalize(vObjNormal);
  vec3 tw = pow(abs(on), vec3(4.0));
  tw.y = on.y > 0.0 ? tw.y : 0.0;
  tw /= max(1e-4, tw.x + tw.y + tw.z);
  vec3 p = vObjPos;
  vec2 sideUv = on.x < 0.0
    ? vec2((p.z + 2.1) / 4.2, (0.9 - p.y) / 1.4 * 0.25)
    : vec2((2.1 - p.z) / 4.2, 0.25 + (0.9 - p.y) / 1.4 * 0.25);
  vec2 topUv = vec2((p.z + 2.1) / 4.2, 0.5 + (1.0 - p.x) * 0.125);
  vec2 endUv = on.z > 0.0
    ? vec2((p.x + 1.0) * 0.25, 0.75 + (0.9 - p.y) / 1.4 * 0.25)
    : vec2(0.5 + (1.0 - p.x) * 0.25, 0.75 + (0.9 - p.y) / 1.4 * 0.25);
  sideUv.y = 1.0 - sideUv.y;
  topUv.y = 1.0 - topUv.y;
  endUv.y = 1.0 - endUv.y;
  vec4 liv = texture2D(tLivery, sideUv) * tw.x + texture2D(tLivery, topUv) * tw.y + texture2D(tLivery, endUv) * tw.z;
  vec4 msk = texture2D(tMask, sideUv) * tw.x + texture2D(tMask, topUv) * tw.y + texture2D(tMask, endUv) * tw.z;

  float under = smoothstep(-0.25, -0.6, on.y);
  float inward = smoothstep(0.3, 0.6, -sign(p.x) * on.x);
  carGlass = msk.r * (1.0 - under);
  carMatte = max(msk.g, max(under, inward));
  carChrome = msk.b;
  vec3 base = mix(liv.rgb, vec3(0.015), max(under, inward));

  float dn = texture2D(tDirt, p.zy * 1.1).r * tw.x + texture2D(tDirt, p.zx * 1.1).r * tw.y + texture2D(tDirt, p.xy * 1.1).r * tw.z;
  float low = smoothstep(0.55, -0.42, p.y);
  carDirt = clamp(uDirt * (0.15 + low * 1.2) * (0.55 + dn * 0.9) - 0.1, 0.0, 1.0) * (1.0 - carGlass * 0.55);
  base = mix(base, vec3(0.46, 0.36, 0.26), carDirt * 0.85);
  diffuseColor.rgb *= base;
`

export class CarModel {
  readonly group = new THREE.Group()
  private readonly wheels: { steer: THREE.Group; spin: THREE.Group }[] = []
  private readonly dirt = { value: 0.35 }
  private readonly tailMat = new THREE.MeshStandardMaterial({
    color: 0x5a0608,
    emissive: 0xff1a10,
    emissiveIntensity: 0.4,
    roughness: 0.2,
  })

  constructor() {
    this.buildBody()
    this.buildDetails()
    this.buildWheels()
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
  }

  sync(vehicle: Vehicle): void {
    const t = vehicle.body.translation()
    const r = vehicle.body.rotation()
    this.group.position.set(t.x, t.y, t.z)
    this.group.quaternion.set(r.x, r.y, r.z, r.w)

    vehicle.wheels.forEach((w, i) => {
      const visual = this.wheels[i]
      visual.steer.position.set(w.local.x, w.local.y - w.suspensionLength, w.local.z)
      visual.steer.rotation.y = -w.steer
      visual.spin.rotation.x = w.spin
    })
  }

  setBraking(braking: boolean): void {
    this.tailMat.emissiveIntensity = braking ? 4 : 0.4
  }

  /** 0 = freshly washed, 1 = caked in stage dirt. */
  setDirt(amount: number): void {
    this.dirt.value = THREE.MathUtils.clamp(amount, 0, 1)
  }

  private buildBody(): void {
    const livery = createLivery()
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    })
    const uniforms = {
      tLivery: { value: livery.color },
      tMask: { value: livery.mask },
      tDirt: { value: livery.dirt },
      uDirt: this.dirt,
    }
    paint.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform sampler2D tLivery;
          uniform sampler2D tMask;
          uniform sampler2D tDirt;
          uniform float uDirt;
          varying vec3 vObjPos;
          varying vec3 vObjNormal;
          float carGlass;
          float carMatte;
          float carChrome;
          float carDirt;`,
        )
        .replace('#include <map_fragment>', LIVERY_GLSL)
        .replace(
          'float roughnessFactor = roughness;',
          /* glsl */ `float roughnessFactor = mix(roughness, 0.07, carGlass);
          roughnessFactor = mix(roughnessFactor, 0.6, carMatte * (1.0 - carGlass));
          roughnessFactor = mix(roughnessFactor, 0.18, carChrome * (1.0 - carGlass));
          roughnessFactor = mix(roughnessFactor, 0.95, carDirt);`,
        )
        .replace(
          'float metalnessFactor = metalness;',
          'float metalnessFactor = mix(metalness, 0.9, carChrome * (1.0 - carGlass));',
        )
        .replace(
          '#include <lights_physical_fragment>',
          /* glsl */ `#include <lights_physical_fragment>
          // Tinted glass reads darker in games than physically neutral glass would.
          material.specularColor *= 1.0 - 0.7 * carGlass;
          material.specularColorBlended *= 1.0 - 0.7 * carGlass;
          material.specularF90 *= 1.0 - 0.7 * carGlass;`,
        )
        .replace(
          'material.clearcoat = clearcoat;',
          'material.clearcoat = clearcoat * (1.0 - carMatte) * (1.0 - carDirt) * (1.0 - 0.85 * carGlass);',
        )
    }
    paint.customProgramCacheKey = () => 'car-livery'

    const body = new THREE.Mesh(buildBodyGeometry(), paint)
    body.receiveShadow = true
    body.name = 'body'
    this.group.add(body)
  }

  private buildDetails(): void {
    const matte = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6 })
    const carbon = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 })
    const blue = new THREE.MeshPhysicalMaterial({ color: 0x1b56f0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 })
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f2ef, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 })
    const alloy = new THREE.MeshStandardMaterial({ color: 0x8a8c90, roughness: 0.45, metalness: 0.9 })
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.25, metalness: 1, side: THREE.DoubleSide })
    const mirrorGlass = new THREE.MeshStandardMaterial({ color: 0x8a96a0, roughness: 0.02, metalness: 1 })
    const lamp = new THREE.MeshStandardMaterial({ color: 0xf4f2ea, emissive: 0xfff2d0, emissiveIntensity: 1.6, roughness: 0.1 })
    const hook = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.4 })

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y, z)
      mesh.rotation.set(rx, ry, rz)
      this.group.add(mesh)
      return mesh
    }

    // Rear wing: airfoil main plane, endplates and pylons.
    const foil = new THREE.Shape()
    foil.moveTo(0, 0)
    foil.bezierCurveTo(-0.02, 0.035, -0.12, 0.05, -0.38, 0.02)
    foil.lineTo(-0.38, 0.004)
    foil.bezierCurveTo(-0.2, 0.0, -0.06, -0.015, 0, 0)
    const wingGeo = new THREE.ExtrudeGeometry(foil, { depth: 1.5, bevelEnabled: false, curveSegments: 10 })
    wingGeo.translate(0, 0, -0.75)
    wingGeo.rotateY(-Math.PI / 2)
    add(wingGeo, carbon, 0, 0.9, -1.46, 0.06)
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.014, 0.17, 0.42), carbon, s * 0.755, 0.89, -1.66)
      add(new THREE.BoxGeometry(0.016, 0.03, 0.42), blue, s * 0.755, 0.985, -1.66)
      add(new THREE.BoxGeometry(0.022, 0.18, 0.16), carbon, s * 0.34, 0.8, -1.6)
    }
    add(new THREE.BoxGeometry(1.22, 0.025, 0.26), carbon, 0, topY(-1.45) + 0.005, -1.52, -0.32)

    // Mirrors.
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(1, 16, 10).scale(0.1, 0.06, 0.075), white, s * 0.96, 0.4, 0.56)
      add(new THREE.BoxGeometry(0.12, 0.025, 0.05), matte, s * 0.87, 0.37, 0.58)
      add(new THREE.CircleGeometry(1, 16).scale(0.085, 0.048, 1), mirrorGlass, s * 0.96, 0.4, 0.484, 0, Math.PI)
    }

    // Roof scoop and antenna.
    add(new THREE.BoxGeometry(0.34, 0.05, 0.3), matte, 0, topY(-0.25) + 0.03, -0.25)
    add(new THREE.CylinderGeometry(0.003, 0.006, 0.36, 6), matte, 0.22, topY(-1.2) + 0.18, -1.2)

    // Lamps.
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(1, 20, 10).scale(0.19, 0.04, 0.05), lamp, s * 0.53, 0.118, 1.955, 0, s * 0.18)
      add(new THREE.SphereGeometry(1, 12, 8).scale(0.055, 0.055, 0.02), lamp, s * 0.6, -0.2, 2.025)
      add(new THREE.BoxGeometry(0.09, 0.28, 0.04), this.tailMat, s * 0.73, 0.32, -1.915, -0.45)
    }

    // Splitter, sump guard, mud flaps, exhaust and tow hooks.
    add(new THREE.BoxGeometry(1.42, 0.025, 0.16), carbon, 0, -0.395, 1.95)
    add(new THREE.BoxGeometry(1.0, 0.02, 1.1), alloy, 0, -0.41, 1.25)
    for (const s of [-1, 1]) {
      for (const cz of [CAR.frontAxle, CAR.rearAxle]) {
        add(new THREE.BoxGeometry(0.24, 0.22, 0.012), matte, s * 0.72, -0.47, cz - 0.5)
      }
    }
    add(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 14, 1, true), pipeMat, -0.5, -0.33, -1.95, Math.PI / 2)
    add(new THREE.CircleGeometry(0.042, 14), matte, -0.5, -0.33, -1.93, 0, Math.PI)
    add(new THREE.TorusGeometry(0.035, 0.009, 6, 14), hook, 0.5, -0.29, 2.035, 0, Math.PI / 2)
    add(new THREE.TorusGeometry(0.035, 0.009, 6, 14), hook, -0.55, -0.27, -2.0, 0, Math.PI / 2)
  }

  private buildWheels(): void {
    const tread = createTreadTexture()
    const tyreMat = new THREE.MeshStandardMaterial({
      map: tread,
      bumpMap: tread,
      bumpScale: 2.5,
      roughness: 0.92,
      color: 0x6a645c,
    })
    const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xf0eee8, roughness: 0.3, metalness: 0.2, clearcoat: 0.6 })
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide })
    const discMat = new THREE.MeshStandardMaterial({ color: 0x5c5a58, roughness: 0.38, metalness: 0.9 })
    const caliperMat = new THREE.MeshPhysicalMaterial({ color: 0xd8b21a, roughness: 0.35, clearcoat: 1 })
    const nutMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.3, metalness: 0.8 })

    const r = CAR.wheelRadius
    const profile = [
      [0.19, -0.11],
      [0.27, -0.122],
      [r - 0.018, -0.118],
      [r - 0.002, -0.1],
      [r, -0.07],
      [r, 0.07],
      [r - 0.002, 0.1],
      [r - 0.018, 0.118],
      [0.27, 0.122],
      [0.19, 0.11],
    ].map(([a, b]) => new THREE.Vector2(a, b))
    const tyreGeo = new THREE.LatheGeometry(profile, 48).rotateZ(Math.PI / 2)
    const barrelGeo = new THREE.CylinderGeometry(0.192, 0.192, 0.22, 32, 1, true).rotateZ(Math.PI / 2)
    const discGeo = new THREE.CylinderGeometry(0.155, 0.155, 0.026, 32).rotateZ(Math.PI / 2)
    const nutGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.03, 12).rotateZ(Math.PI / 2)
    const faceGeo = buildRimFace()

    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? 1 : -1
      const steer = new THREE.Group()
      const spin = new THREE.Group()
      steer.add(spin)

      spin.add(new THREE.Mesh(tyreGeo, tyreMat))
      spin.add(new THREE.Mesh(barrelGeo, barrelMat))
      const face = new THREE.Mesh(faceGeo, rimMat)
      face.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2
      face.position.x = side * 0.045
      spin.add(face)
      const nut = new THREE.Mesh(nutGeo, nutMat)
      nut.position.x = side * 0.085
      spin.add(nut)
      const disc = new THREE.Mesh(discGeo, discMat)
      disc.position.x = -side * 0.02
      spin.add(disc)

      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.08), caliperMat)
      caliper.position.set(-side * 0.01, 0.1, i < 2 ? -0.08 : 0.08)
      caliper.rotation.x = i < 2 ? -0.6 : 0.6
      steer.add(caliper)

      this.group.add(steer)
      this.wheels.push({ steer, spin })
    }
  }
}

function buildBodyGeometry(): THREE.BufferGeometry {
  const zs = stations()
  const ring = (z: number): [number, number][] => {
    const half = halfSection(z)
    const right = half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])
    return [...half, ...right]
  }
  const ringSize = ring(0).length
  const positions: number[] = []
  const indices: number[] = []

  zs.forEach((z) => {
    for (const [x, y] of ring(z)) positions.push(x, y, z)
  })
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < ringSize; j++) {
      const a = i * ringSize + j
      const b = i * ringSize + ((j + 1) % ringSize)
      const c = (i + 1) * ringSize + j
      const d = (i + 1) * ringSize + ((j + 1) % ringSize)
      indices.push(a, b, c, c, b, d)
    }
  }

  const body = new THREE.BufferGeometry()
  body.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  body.setIndex(indices)
  body.computeVertexNormals()

  // Flat bumper caps at both ends.
  const caps: number[] = []
  for (const [z, dir] of [[BODY.front, 1], [BODY.rear, -1]] as const) {
    const pts = ring(z)
    const cx = 0
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
    for (let j = 0; j < pts.length; j++) {
      const p0 = pts[j]
      const p1 = pts[(j + 1) % pts.length]
      if (dir > 0) caps.push(cx, cy, z, p0[0], p0[1], z, p1[0], p1[1], z)
      else caps.push(cx, cy, z, p1[0], p1[1], z, p0[0], p0[1], z)
    }
  }
  const capGeo = new THREE.BufferGeometry()
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(caps, 3))
  capGeo.computeVertexNormals()

  return mergeGeometries(body.toNonIndexed(), capGeo)
}

function mergeGeometries(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry()
  for (const name of ['position', 'normal']) {
    const aa = a.getAttribute(name).array as Float32Array
    const bb = b.getAttribute(name).array as Float32Array
    const merged = new Float32Array(aa.length + bb.length)
    merged.set(aa, 0)
    merged.set(bb, aa.length)
    out.setAttribute(name, new THREE.BufferAttribute(merged, 3))
  }
  out.computeBoundingSphere()
  return out
}

/** Six-spoke gravel rim face, extruded along +z (rotated to face outward by the caller). */
function buildRimFace(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, 0.19, 0, Math.PI * 2, false)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6
    const hole = new THREE.Path()
    const outer = 0.163
    const inner = 0.065
    hole.absarc(0, 0, outer, a - 0.36, a + 0.36, false)
    hole.lineTo(Math.cos(a + 0.22) * inner, Math.sin(a + 0.22) * inner)
    hole.absarc(0, 0, inner, a + 0.22, a - 0.22, true)
    hole.closePath()
    shape.holes.push(hole)
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.025,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.005,
    bevelSegments: 2,
    curveSegments: 24,
  })
  geo.translate(0, 0, -0.0125)
  return geo
}

function createTreadTexture(): THREE.CanvasTexture {
  const w = 1024
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#1e1e1e'
  ctx.fillRect(0, 0, w, h)

  // Knobby gravel tread across the contact band (the middle of the lathe profile).
  const band0 = h * 0.3
  const band1 = h * 0.7
  const blocks = 36
  for (let i = 0; i < blocks; i++) {
    const x = (i / blocks) * w
    const bw = w / blocks
    for (let row = 0; row < 3; row++) {
      const y = band0 + ((band1 - band0) * row) / 3
      const offset = row === 1 ? bw * 0.5 : 0
      ctx.fillStyle = '#5a5a5a'
      ctx.fillRect(x + offset + bw * 0.12, y + 4, bw * 0.62, (band1 - band0) / 3 - 9)
    }
  }
  ctx.fillStyle = '#2c2c2c'
  ctx.font = 'bold 22px Arial, sans-serif'
  ctx.textAlign = 'center'
  for (const y of [h * 0.14, h * 0.86]) {
    for (let i = 0; i < 3; i++) {
      ctx.save()
      ctx.translate((i + 0.5) * (w / 3), y)
      ctx.fillStyle = '#3a3a3a'
      ctx.fillText('RIDGELINE  GRAVEL  G5', 0, 8)
      ctx.restore()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}

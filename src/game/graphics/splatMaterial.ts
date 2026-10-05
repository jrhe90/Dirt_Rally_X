import * as THREE from 'three'
import type { PbrSet } from './assets'

export type SplatLayer = PbrSet & {
  /** Texture repeats per meter. */
  scale: number
}

export type SplatOptions = {
  /** Darken wheel ruts using a per-vertex `lateral` attribute (meters from the centerline). */
  ruts?: boolean
  vertexColors?: boolean
  normalStrength?: number
}

/**
 * Standard PBR material that height-blends three texture sets by a per-vertex `splat` weight
 * attribute. UVs are world-space meters so neighbouring meshes tile seamlessly.
 */
export function createSplatMaterial(
  layers: [SplatLayer, SplatLayer, SplatLayer],
  options: SplatOptions = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: layers[0].diff,
    normalMap: layers[0].nor,
    normalScale: new THREE.Vector2(1, 1).multiplyScalar(options.normalStrength ?? 1),
    roughness: 1,
    metalness: 0,
    vertexColors: options.vertexColors ?? false,
  })

  const uniforms = {
    tDiff0: { value: layers[0].diff },
    tDiff1: { value: layers[1].diff },
    tDiff2: { value: layers[2].diff },
    tNor0: { value: layers[0].nor },
    tNor1: { value: layers[1].nor },
    tNor2: { value: layers[2].nor },
    tArm0: { value: layers[0].arm },
    tArm1: { value: layers[1].arm },
    tArm2: { value: layers[2].arm },
    uScale: { value: new THREE.Vector3(layers[0].scale, layers[1].scale, layers[2].scale) },
    uSharp: { value: 6 },
  }

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    if (options.ruts) shader.defines = { ...shader.defines, SPLAT_RUTS: '' }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec3 splat;
        varying vec3 vSplat;
        #ifdef SPLAT_RUTS
          attribute float lateral;
          varying float vLateral;
        #endif`,
      )
      .replace(
        '#include <uv_vertex>',
        /* glsl */ `#include <uv_vertex>
        vSplat = splat;
        #ifdef SPLAT_RUTS
          vLateral = lateral;
        #endif`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D tDiff0;
        uniform sampler2D tDiff1;
        uniform sampler2D tDiff2;
        uniform sampler2D tNor0;
        uniform sampler2D tNor1;
        uniform sampler2D tNor2;
        uniform sampler2D tArm0;
        uniform sampler2D tArm1;
        uniform sampler2D tArm2;
        uniform vec3 uScale;
        uniform float uSharp;
        varying vec3 vSplat;
        #ifdef SPLAT_RUTS
          varying float vLateral;
        #endif
        vec3 splatW;
        float splatRough;

        // Second, rotated and scaled sample breaks up visible tiling.
        vec3 splatDiffuse(sampler2D tex, vec2 uv) {
          vec3 a = texture2D(tex, uv).rgb;
          vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.31;
          vec3 b = texture2D(tex, r).rgb;
          return mix(a, b, 0.4);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 uv0 = vMapUv * uScale.x;
        vec2 uv1 = vMapUv * uScale.y;
        vec2 uv2 = vMapUv * uScale.z;
        vec4 arm0 = texture2D(tArm0, uv0);
        vec4 arm1 = texture2D(tArm1, uv1);
        vec4 arm2 = texture2D(tArm2, uv2);
        vec3 height = vec3(arm0.r, arm1.r, arm2.r);
        vec3 w = max(vSplat, vec3(0.0)) * (height + 0.35) + 1e-4;
        w = pow(w, vec3(uSharp));
        splatW = w / (w.x + w.y + w.z);

        vec3 albedo = splatDiffuse(tDiff0, uv0) * splatW.x
          + splatDiffuse(tDiff1, uv1) * splatW.y
          + splatDiffuse(tDiff2, uv2) * splatW.z;
        float ao = dot(height, splatW);
        splatRough = arm0.g * splatW.x + arm1.g * splatW.y + arm2.g * splatW.z;

        #ifdef SPLAT_RUTS
          float lat = abs(vLateral);
          float rut = exp(-pow((lat - 0.85) / 0.32, 2.0));
          float loose = smoothstep(2.6, 4.8, lat) * (1.0 - smoothstep(5.2, 6.4, lat));
          albedo *= 1.0 - 0.28 * rut * (1.0 - splatW.z);
          albedo = mix(albedo, albedo * vec3(1.12, 1.08, 1.02), loose * splatW.x);
          splatRough *= 1.0 - 0.25 * rut * splatW.y;
        #endif

        diffuseColor.rgb *= albedo * mix(1.0, ao, 0.6);
        `,
      )
      .replace('float roughnessFactor = roughness;', 'float roughnessFactor = roughness * splatRough;')
      .replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        /* glsl */ `vec3 mapN = (texture2D(tNor0, vNormalMapUv * uScale.x).xyz * splatW.x
          + texture2D(tNor1, vNormalMapUv * uScale.y).xyz * splatW.y
          + texture2D(tNor2, vNormalMapUv * uScale.z).xyz * splatW.z) * 2.0 - 1.0;`,
      )
  }
  material.customProgramCacheKey = () => `splat-${options.ruts ? 'ruts' : 'plain'}`
  return material
}

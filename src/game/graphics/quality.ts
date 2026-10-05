export type QualityTier = 'low' | 'high'

export type Quality = {
  tier: QualityTier
  pixelRatio: number
  shadowMapSize: number
  ambientOcclusion: boolean
  grassCount: number
  dustParticles: number
}

export function detectQuality(): Quality {
  const param = new URLSearchParams(window.location.search).get('quality')
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const tier: QualityTier = param === 'low' || param === 'high' ? param : coarse ? 'low' : 'high'
  const dpr = window.devicePixelRatio || 1

  return tier === 'high'
    ? {
        tier,
        pixelRatio: Math.min(dpr, 1.75),
        shadowMapSize: 4096,
        ambientOcclusion: true,
        grassCount: 14000,
        dustParticles: 1800,
      }
    : {
        tier,
        pixelRatio: Math.min(dpr, 1.25),
        shadowMapSize: 1024,
        ambientOcclusion: false,
        grassCount: 3500,
        dustParticles: 700,
      }
}

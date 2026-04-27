import { REGISTRY_RISK_RADIUS_METERS } from './config'
import { boundsCachePart, cachedRequest } from './apiCache'
import { clamp, latLngToMeters, metersPerDegreeLngForBounds } from './geo'
import type { MapBounds, RegistryRiskLevel, RegistryRiskPoint } from './types'

type RegistryRiskPayload = {
  points?: Array<{
    id?: string | number
    lat?: string | number
    lng?: string | number
    lon?: string | number
    riskLevel?: string
    level?: string | number
    source?: string
  }>
}

const riskWeightByLevel: Record<RegistryRiskLevel, number> = {
  unknown: 0.5,
  low: 0.35,
  moderate: 0.7,
  high: 1,
}

const normalizeRiskLevel = (value: unknown): RegistryRiskLevel => {
  const normalized = String(value ?? '').trim().toLowerCase()

  if (['3', 'high', 'level 3', 'tier 3'].includes(normalized)) {
    return 'high'
  }

  if (['2', 'moderate', 'medium', 'level 2', 'tier 2'].includes(normalized)) {
    return 'moderate'
  }

  if (['1', 'low', 'level 1', 'tier 1'].includes(normalized)) {
    return 'low'
  }

  return 'unknown'
}

const pointInBounds = (point: RegistryRiskPoint, bounds: MapBounds) =>
  point.lat >= bounds.south &&
  point.lat <= bounds.north &&
  point.lng >= bounds.west &&
  point.lng <= bounds.east

const parseRegistryRiskPayload = (
  payload: RegistryRiskPayload,
  bounds: MapBounds,
): RegistryRiskPoint[] =>
  (payload.points ?? [])
    .map((item, index): RegistryRiskPoint | null => {
      const lat = Number(item.lat)
      const lng = Number(item.lng ?? item.lon)
      const riskLevel = normalizeRiskLevel(item.riskLevel ?? item.level)

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null
      }

      const point: RegistryRiskPoint = {
        id: String(item.id ?? `registry-${index}`),
        lat,
        lng,
        riskLevel,
        weight: riskWeightByLevel[riskLevel],
        source: item.source ?? 'local dataset',
      }

      return pointInBounds(point, bounds) ? point : null
    })
    .filter((point): point is RegistryRiskPoint => Boolean(point))

export const fetchRegistryRiskPoints = async (
  signal: AbortSignal,
  bounds: MapBounds,
  force = false,
) =>
  cachedRequest<RegistryRiskPoint[]>(
    `registry-risk:${boundsCachePart(bounds)}`,
    async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}registry-risk.json`, { signal })

      if (response.status === 404) {
        return []
      }

      if (!response.ok) {
        throw new Error(`Registry risk ${response.status}`)
      }

      const payload = (await response.json()) as RegistryRiskPayload

      return parseRegistryRiskPayload(payload, bounds)
    },
    { force },
  )

export const registryRiskScoreAtPoint = (
  point: { lat: number; lng: number },
  registryRiskPoints: RegistryRiskPoint[],
  averageRegistryDensity: number,
  bounds: MapBounds,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
) => {
  if (registryRiskPoints.length === 0) {
    return 0.5
  }

  const center = latLngToMeters(point, bounds, metersPerDegreeLng)
  let localWeightedDensity = 0

  for (const registryPoint of registryRiskPoints) {
    const registryMeters = latLngToMeters(registryPoint, bounds, metersPerDegreeLng)
    const distance = Math.hypot(center.x - registryMeters.x, center.y - registryMeters.y)

    if (distance <= REGISTRY_RISK_RADIUS_METERS) {
      const normalizedDistance = distance / REGISTRY_RISK_RADIUS_METERS
      localWeightedDensity +=
        registryPoint.weight * Math.exp(-(normalizedDistance * normalizedDistance) / 0.5)
    }
  }

  const baseline = Math.max(averageRegistryDensity * 1.6, 0.18)

  return clamp(1 - localWeightedDensity / (baseline * 2.6))
}

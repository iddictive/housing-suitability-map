import { REGION_OPTIONS } from './config'
import { boundsCachePart, cachedRequest } from './apiCache'
import { centerForBounds, genericCityCheckpoints, limitBoundsAroundCenter } from './geo'
import type { CityConfig, LatLng, MapBounds, RegionOption } from './types'

type NominatimPlace = {
  lat: string
  lon: string
  display_name: string
  addresstype?: string
  type?: string
  address?: Record<string, string | undefined>
  boundingbox?: [string, string, string, string]
  geojson?: {
    type?: string
    coordinates?: unknown
  }
}

export const isUsZipCode = (value: string) => /^\d{5}(?:-\d{4})?$/.test(value.trim())

export const titleCasePlaceName = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (/^[A-Z]{2,}$/.test(word) || /^\d/.test(word)) {
        return word
      }

      return word
        .split('-')
        .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part))
        .join('-')
    })
    .join(' ')

export const slugifyFilePart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'region'

const normalizeRing = (points: LatLng[]) => {
  if (points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]

    if (Math.abs(first.lat - last.lat) < 1e-8 && Math.abs(first.lng - last.lng) < 1e-8) {
      return points.slice(0, -1)
    }
  }

  return points
}

const isCityLevelPlace = (place: NominatimPlace) => {
  const address = place.address ?? {}
  const hasLocality = Boolean(
    address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.borough ||
      address.township ||
      address.hamlet,
  )

  if (hasLocality) {
    return true
  }

  return ['city', 'town', 'village', 'municipality', 'borough', 'township', 'hamlet'].includes(
    place.addresstype ?? '',
  )
}

const latLngFromGeoJsonPosition = (position: unknown): LatLng | null => {
  if (!Array.isArray(position) || position.length < 2) {
    return null
  }

  const lng = Number(position[0])
  const lat = Number(position[1])

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

const latLngRingFromGeoJsonRing = (ring: unknown): LatLng[] => {
  if (!Array.isArray(ring)) {
    return []
  }

  const points = ring
    .map(latLngFromGeoJsonPosition)
    .filter((point): point is LatLng => Boolean(point))

  return normalizeRing(points)
}

const cityBoundaryAreasFromGeoJson = (geojson: NominatimPlace['geojson']) => {
  if (!geojson?.coordinates) {
    return []
  }

  const polygons =
    geojson.type === 'Polygon'
      ? [geojson.coordinates]
      : geojson.type === 'MultiPolygon' && Array.isArray(geojson.coordinates)
        ? geojson.coordinates
        : []

  return polygons
    .map((polygon) => {
      if (!Array.isArray(polygon)) {
        return null
      }

      const [outerRing, ...innerRings] = polygon
      const points = latLngRingFromGeoJsonRing(outerRing)

      if (points.length < 3) {
        return null
      }

      const holes = innerRings
        .map(latLngRingFromGeoJsonRing)
        .filter((hole) => hole.length >= 3)

      return { points, holes }
    })
    .filter((area): area is { points: LatLng[]; holes: LatLng[][] } => Boolean(area))
}

const cityConfigFromNominatimPlace = (
  place: NominatimPlace,
  region: RegionOption,
  label: string,
  idPrefix: string,
): CityConfig => {
  const lat = Number(place.lat)
  const lng = Number(place.lon)
  const [southRaw, northRaw, westRaw, eastRaw] = place.boundingbox ?? []
  const bounds = {
    south: Number(southRaw),
    north: Number(northRaw),
    west: Number(westRaw),
    east: Number(eastRaw),
  }
  const fallbackBounds = {
    south: lat - 0.025,
    north: lat + 0.025,
    west: lng - 0.035,
    east: lng + 0.035,
  }
  const center = { lat, lng }
  const boundaryAreas = cityBoundaryAreasFromGeoJson(place.geojson)
  const hasFiniteBounds = Object.values(bounds).every(Number.isFinite)
  const cityLatSpan = bounds.north - bounds.south
  const cityLngSpan = bounds.east - bounds.west
  const canUseBoundaryBounds =
    boundaryAreas.length > 0 &&
    hasFiniteBounds &&
    cityLatSpan > 0 &&
    cityLngSpan > 0 &&
    cityLatSpan <= 0.9 &&
    cityLngSpan <= 1.2
  const limitedBounds = limitBoundsAroundCenter(hasFiniteBounds ? bounds : fallbackBounds, center)
  const safeBounds = canUseBoundaryBounds ? bounds : limitedBounds

  return {
    id: `${idPrefix}-${region.code}-${slugifyFilePart(label)}`,
    countryCode: region.countryCode,
    state: region.code,
    city: label,
    bounds: safeBounds,
    dataBounds: canUseBoundaryBounds ? limitedBounds : undefined,
    boundaryAreas: boundaryAreas.length > 0 ? boundaryAreas : undefined,
    center,
    checkpoints: genericCityCheckpoints(label, safeBounds, center),
  }
}

const citySearchQuery = (city: string, region: RegionOption) =>
  region.countryCode === 'us'
    ? `${city}, ${region.name}, ${region.countryName}`
    : `${city}, ${region.countryName}`

export const fetchCityConfig = async (regionCode: string, cityName: string): Promise<CityConfig> => {
  const region = REGION_OPTIONS.find((item) => item.code === regionCode)
  const city = titleCasePlaceName(cityName)

  if (!region || city.length === 0) {
    throw new Error('city required')
  }

  if (
    [region.name.toLowerCase(), region.code.toLowerCase(), region.countryName.toLowerCase()].includes(
      city.toLowerCase(),
    )
  ) {
    throw new Error('city required')
  }

  const searchParams = new URLSearchParams({
    format: 'jsonv2',
    limit: '5',
    countrycodes: region.countryCode,
    addressdetails: '1',
    polygon_geojson: '1',
    q: citySearchQuery(city, region),
  })
  const cacheKey = `geocode:${region.code}:${city.toLowerCase()}`
  const places = await cachedRequest<NominatimPlace[]>(cacheKey, async () => {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams}`)

    if (!response.ok) {
      throw new Error(`Nominatim ${response.status}`)
    }

    return (await response.json()) as NominatimPlace[]
  })
  const place = places.find(isCityLevelPlace)

  if (!place) {
    throw new Error('city not found')
  }

  return cityConfigFromNominatimPlace(place, region, city, 'custom')
}

export const fetchZipConfig = async (regionCode: string, zipCode: string): Promise<CityConfig> => {
  const region = REGION_OPTIONS.find((item) => item.code === regionCode)
  const normalizedZip = zipCode.trim()

  if (!region || !region.supportsPostalCode || !isUsZipCode(normalizedZip)) {
    throw new Error('zip required')
  }

  const searchParams = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: region.countryCode,
    addressdetails: '1',
    postalcode: normalizedZip,
    state: region.name,
  })
  const cacheKey = `zip:${region.code}:${normalizedZip.toLowerCase()}`
  const places = await cachedRequest<NominatimPlace[]>(cacheKey, async () => {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams}`)

    if (!response.ok) {
      throw new Error(`Nominatim ${response.status}`)
    }

    return (await response.json()) as NominatimPlace[]
  })
  const place = places[0]

  if (!place) {
    throw new Error('zip not found')
  }

  return cityConfigFromNominatimPlace(place, region, `ZIP ${normalizedZip}`, 'zip')
}

export const buildRegionCityConfig = (baseCity: CityConfig, bounds: MapBounds): CityConfig => {
  const center = centerForBounds(bounds)
  const baseLabel = baseCity.city.startsWith('Region ')
    ? baseCity.city.replace(/^Region\s+/, '')
    : baseCity.city
  const label = `Region ${titleCasePlaceName(baseLabel)}`

  return {
    id: `region-${baseCity.state}-${boundsCachePart(bounds)}`,
    countryCode: baseCity.countryCode,
    state: baseCity.state,
    city: label,
    bounds,
    center,
    scoreCenter: baseCity.scoreCenter ?? baseCity.center,
    checkpoints: genericCityCheckpoints(label, bounds, center),
  }
}

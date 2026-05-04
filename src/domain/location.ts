import { US_STATES } from './config'
import { cachedRequest, boundsCachePart } from './apiCache'
import { centerForBounds, genericCityCheckpoints, limitBoundsAroundCenter } from './geo'
import type { CityConfig, MapBounds } from './types'

type NominatimPlace = {
  lat: string
  lon: string
  display_name: string
  addresstype?: string
  type?: string
  address?: Record<string, string | undefined>
  boundingbox?: [string, string, string, string]
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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'region'

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

const cityConfigFromNominatimPlace = (
  place: NominatimPlace,
  stateCode: string,
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
  const safeBounds = limitBoundsAroundCenter(
    Object.values(bounds).every(Number.isFinite) ? bounds : fallbackBounds,
    center,
  )

  return {
    id: `${idPrefix}-${stateCode}-${slugifyFilePart(label)}`,
    state: stateCode,
    city: label,
    bounds: safeBounds,
    center,
    checkpoints: genericCityCheckpoints(label, safeBounds, center),
  }
}

export const fetchCityConfig = async (stateCode: string, cityName: string): Promise<CityConfig> => {
  const state = US_STATES.find((item) => item.code === stateCode)
  const city = titleCasePlaceName(cityName)

  if (!state || city.length === 0) {
    throw new Error('city required')
  }

  if ([state.name.toLowerCase(), state.code.toLowerCase()].includes(city.toLowerCase())) {
    throw new Error('city required')
  }

  const searchParams = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'us',
    addressdetails: '1',
    q: `${city}, ${state.name}, USA`,
  })
  const cacheKey = `geocode:${stateCode}:${city.toLowerCase()}`
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

  return cityConfigFromNominatimPlace(place, stateCode, city, 'custom')
}

export const fetchZipConfig = async (stateCode: string, zipCode: string): Promise<CityConfig> => {
  const state = US_STATES.find((item) => item.code === stateCode)
  const normalizedZip = zipCode.trim()

  if (!state || !isUsZipCode(normalizedZip)) {
    throw new Error('zip required')
  }

  const searchParams = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'us',
    addressdetails: '1',
    postalcode: normalizedZip,
    state: state.name,
  })
  const cacheKey = `zip:${stateCode}:${normalizedZip.toLowerCase()}`
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

  return cityConfigFromNominatimPlace(place, stateCode, `ZIP ${normalizedZip}`, 'zip')
}

export const buildRegionCityConfig = (baseCity: CityConfig, bounds: MapBounds): CityConfig => {
  const center = centerForBounds(bounds)
  const baseLabel = baseCity.city.startsWith('Регион ')
    ? baseCity.city.replace(/^Регион\s+/, '')
    : baseCity.city
  const label = `Регион ${titleCasePlaceName(baseLabel)}`

  return {
    id: `region-${baseCity.state}-${boundsCachePart(bounds)}`,
    state: baseCity.state,
    city: label,
    bounds,
    center,
    checkpoints: genericCityCheckpoints(label, bounds, center),
  }
}

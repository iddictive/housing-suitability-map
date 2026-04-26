import { BOSTON_BOUNDS, MAX_CITY_LAT_SPAN, MAX_CITY_LNG_SPAN, METERS_PER_DEGREE_LAT } from './config'
import type { LatLng, MapBounds, SuitabilityField } from './types'

export type ProjectedPoint = {
  x: number
  y: number
}

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

export const metersPerDegreeLngForBounds = (bounds: MapBounds) => {
  const referenceLat = (bounds.south + bounds.north) / 2

  return METERS_PER_DEGREE_LAT * Math.cos((referenceLat * Math.PI) / 180)
}

export const latLngToMeters = (
  point: LatLng,
  bounds = BOSTON_BOUNDS,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
) => ({
  x: (point.lng - bounds.west) * metersPerDegreeLng,
  y: (bounds.north - point.lat) * METERS_PER_DEGREE_LAT,
})

export const fieldBounds = (field: Pick<SuitabilityField, 'south' | 'west' | 'north' | 'east'>): MapBounds => ({
  south: field.south,
  west: field.west,
  north: field.north,
  east: field.east,
})

export const approximatePolygonAreaSqm = (points: LatLng[], bounds = BOSTON_BOUNDS) => {
  if (points.length < 3) {
    return 0
  }

  const metersPerDegreeLng = metersPerDegreeLngForBounds(bounds)
  let area = 0
  const projected = points.map((point) => latLngToMeters(point, bounds, metersPerDegreeLng))

  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index]
    const next = projected[(index + 1) % projected.length]

    area += current.x * next.y - next.x * current.y
  }

  return Math.abs(area) / 2
}

export const boundsToBbox = (bounds: MapBounds) =>
  `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`

export const limitBoundsAroundCenter = (bounds: MapBounds, center: LatLng): MapBounds => {
  const latSpan = Math.min(bounds.north - bounds.south, MAX_CITY_LAT_SPAN)
  const lngSpan = Math.min(bounds.east - bounds.west, MAX_CITY_LNG_SPAN)

  return {
    south: center.lat - latSpan / 2,
    north: center.lat + latSpan / 2,
    west: center.lng - lngSpan / 2,
    east: center.lng + lngSpan / 2,
  }
}

export const genericCityCheckpoints = (city: string, bounds: MapBounds, center: LatLng) => {
  const latSpan = bounds.north - bounds.south
  const lngSpan = bounds.east - bounds.west

  return [
    { name: `${city} center`, ...center },
    { name: `${city} north`, lat: center.lat + latSpan * 0.22, lng: center.lng },
    { name: `${city} south`, lat: center.lat - latSpan * 0.22, lng: center.lng },
    { name: `${city} east`, lat: center.lat, lng: center.lng + lngSpan * 0.22 },
    { name: `${city} west`, lat: center.lat, lng: center.lng - lngSpan * 0.22 },
  ]
}

export const normalizeBounds = (start: LatLng, end: LatLng): MapBounds => ({
  south: Math.min(start.lat, end.lat),
  west: Math.min(start.lng, end.lng),
  north: Math.max(start.lat, end.lat),
  east: Math.max(start.lng, end.lng),
})

export const centerForBounds = (bounds: MapBounds): LatLng => ({
  lat: (bounds.south + bounds.north) / 2,
  lng: (bounds.west + bounds.east) / 2,
})

export const nearestMeters = (x: number, y: number, points: ProjectedPoint[]) => {
  if (points.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  let nearestSquared = Number.POSITIVE_INFINITY

  for (const point of points) {
    const dx = x - point.x
    const dy = y - point.y
    const squared = dx * dx + dy * dy

    if (squared < nearestSquared) {
      nearestSquared = squared
    }
  }

  return Math.sqrt(nearestSquared)
}

export const pointToSegmentDistanceMeters = (
  x: number,
  y: number,
  start: ProjectedPoint,
  end: ProjectedPoint,
) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(x - start.x, y - start.y)
  }

  const progress = clamp(((x - start.x) * dx + (y - start.y) * dy) / lengthSquared)
  const projectedX = start.x + progress * dx
  const projectedY = start.y + progress * dy

  return Math.hypot(x - projectedX, y - projectedY)
}

export const pointInPolygon = (x: number, y: number, polygon: ProjectedPoint[]) => {
  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const intersects =
      currentPoint.y > y !== previousPoint.y > y &&
      x <
        ((previousPoint.x - currentPoint.x) * (y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

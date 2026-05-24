import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Popup,
  Rectangle,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet'
import {
  Building2,
  Download,
  Eye,
  EyeOff,
  Layers3,
  Languages,
  Loader2,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  Search,
  ShieldAlert,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  TrainFront,
  TreePine,
  UserRoundSearch,
  Volume2,
} from 'lucide-react'
import {
  AIRPORT_HARD_NOISE_METERS,
  AIRPORT_SOFT_NOISE_METERS,
  BOSTON_BOUNDS,
  BUILDING_MATCH_RADIUS_METERS,
  BUILDING_STORE_LIMIT,
  CITY_OPTIONS,
  CRIME_RADIUS_METERS,
  CRIME_RESOURCE_ID,
  DEFAULT_CELL_SIZE_METERS,
  EVALUATION_PROFILES,
  FALLBACK_POIS,
  INITIAL_CRITERIA,
  INITIAL_LOAD_STAGES,
  MAJOR_CITIES_BY_REGION,
  MAJOR_ROAD_HARD_NOISE_METERS,
  MAJOR_ROAD_SOFT_NOISE_METERS,
  METERS_PER_DEGREE_LAT,
  RAIL_HARD_NOISE_METERS,
  RAIL_SOFT_NOISE_METERS,
  REGION_OPTIONS,
  REGISTRY_RISK_RADIUS_METERS,
  RESIDENTIAL_BUILDING_EVIDENCE_METERS,
  RESOLUTION_OPTIONS,
  ROAD_SURFACE_NO_GO_BUFFER_METERS,
  SCORE_BANDS,
  TRAFFIC_MAX_AADT,
} from './domain/config'
import {
  boundsCachePart,
  cachedRequest,
  fetchOverpassJson,
  readZoneSnapshot,
  writeZoneSnapshot,
  zoneSnapshotKey,
} from './domain/apiCache'
import {
  approximatePolygonAreaSqm,
  boundsToBbox,
  centerForBounds,
  clamp,
  fieldBounds,
  genericCityCheckpoints,
  latLngToMeters,
  limitBoundsAroundCenter,
  metersPerDegreeLngForBounds,
  nearestMeters,
  normalizeBounds,
  pointInPolygon,
  pointToSegmentDistanceMeters,
} from './domain/geo'
import { fetchRegistryRiskPoints, registryRiskScoreAtPoint } from './domain/registryRisk'
import type {
  Bounds as LeafletBounds,
  LatLngBounds as LeafletLatLngBounds,
  ZoomAnimEvent,
} from 'leaflet'
import type {
  ArcGisPolylineFeature,
  BuildingDataMode,
  BuildingDataSnapshot,
  BuildingFetchResult,
  BuildingFootprint,
  CityConfig,
  CrimeDataMode,
  CrimeIncident,
  CrimeRecord,
  Criterion,
  CriterionId,
  DataMode,
  EvaluationProfile,
  FactorBreakdown,
  LandPenaltyArea,
  LatLng,
  LayerMode,
  LoadStage,
  LoadStageId,
  LoadStageStatus,
  MainDataSnapshot,
  MapBounds,
  NoiseSegment,
  NoiseSourceKind,
  OverpassElement,
  OverpassGeometryPoint,
  Poi,
  PoiCategory,
  PointAnalysis,
  PointDataItem,
  ProjectedPoi,
  RegionOption,
  RegistryDataMode,
  RegistryRiskPoint,
  SavedSite,
  SpatialFactorField,
  SuitabilityField,
  TrafficSegment,
} from './domain/types'
import 'leaflet/dist/leaflet.css'
import './App.css'

const isLocalDevRuntime = () =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

const dataEndpoint = (localProxyPath: string, staticUrl: string) =>
  new URL(isLocalDevRuntime() ? localProxyPath : staticUrl, window.location.origin)

const CATEGORY_META: Record<
  PoiCategory,
  {
    label: string
    color: string
    icon: typeof TreePine
  }
> = {
  parks: { label: 'Parks', color: '#238b45', icon: TreePine },
  groceries: { label: 'Groceries', color: '#1d70b8', icon: ShoppingBasket },
  noise: { label: 'Noise', color: '#bd3b21', icon: Volume2 },
  transit: { label: 'Transit', color: '#635bff', icon: TrainFront },
}

const parkStrengthFromArea = (areaSqm = 0) => {
  const edgeEquivalent = Math.sqrt(Math.max(0, areaSqm))

  return clamp((edgeEquivalent - 40) / 320, 0.05, 1)
}

const isUsZipCode = (value: string) => /^\d{5}(?:-\d{4})?$/.test(value.trim())

const titleCasePlaceName = (value: string) =>
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

const MAX_RENDERED_GRID_CELLS = 45_000
const GRID_SIZE_STEP_METERS = 50

const formatBoundsSummary = (bounds: MapBounds) => {
  const latSpanKm = (bounds.north - bounds.south) * METERS_PER_DEGREE_LAT / 1000
  const lngSpanKm = (bounds.east - bounds.west) * metersPerDegreeLngForBounds(bounds) / 1000

  return `${latSpanKm.toFixed(1)} x ${lngSpanKm.toFixed(1)} km`
}

const renderedCellSizeForBounds = (bounds: MapBounds, requestedCellSizeMeters: number) => {
  const widthMeters = Math.max(1, (bounds.east - bounds.west) * metersPerDegreeLngForBounds(bounds))
  const heightMeters = Math.max(1, (bounds.north - bounds.south) * METERS_PER_DEGREE_LAT)
  const minimumCellSize = Math.sqrt((widthMeters * heightMeters) / MAX_RENDERED_GRID_CELLS)

  return Math.max(
    requestedCellSizeMeters,
    Math.ceil(minimumCellSize / GRID_SIZE_STEP_METERS) * GRID_SIZE_STEP_METERS,
  )
}

const slugifyFilePart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'region'

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

type ResidentialEvidenceField = {
  overlayInclusionMaskByCell: Uint8Array
  residentialCandidateMaskByCell: Uint8Array
  hasResidentialEvidence: boolean
  isProvisionalEligibility: boolean
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
  const safeBounds = canUseBoundaryBounds
    ? bounds
    : limitedBounds

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

const fetchCityConfig = async (regionCode: string, cityName: string): Promise<CityConfig> => {
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

const fetchZipConfig = async (regionCode: string, zipCode: string): Promise<CityConfig> => {
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

const supportsBostonCrimeData = (city: CityConfig) => city.id === 'ma-boston'

const supportsMassDotTrafficData = (city: CityConfig) =>
  city.countryCode === 'us' && city.state === 'MA'

const supportsLocalRegistryRiskData = (city: CityConfig) => city.countryCode === 'us'

const scoreCenterForCity = (city: CityConfig) => city.scoreCenter ?? city.center

const buildOverpassQuery = (bounds: MapBounds) => {
  const bbox = boundsToBbox(bounds)

  return `
[out:json][timeout:45];
(
  node["leisure"="park"](${bbox});
  way["leisure"="park"](${bbox});
  relation["leisure"="park"](${bbox});
  node["shop"~"^(supermarket|grocery|greengrocer|convenience)$"](${bbox});
  way["shop"~"^(supermarket|grocery|greengrocer|convenience)$"](${bbox});
  relation["shop"~"^(supermarket|grocery|greengrocer|convenience)$"](${bbox});
  node["amenity"~"^(bar|pub|nightclub|music_venue)$"](${bbox});
  way["amenity"~"^(bar|pub|nightclub|music_venue)$"](${bbox});
  node["leisure"="nightclub"](${bbox});
  way["leisure"="nightclub"](${bbox});
  node["public_transport"~"^(station|stop_position)$"](${bbox});
  node["railway"~"^(station|subway_entrance|tram_stop)$"](${bbox});
  way["railway"="station"](${bbox});
);
out center geom;`
}

const buildTransportMaskQuery = (bounds: MapBounds) => {
  const bbox = boundsToBbox(bounds)

  return `
[out:json][timeout:45];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${bbox});
  way["railway"~"^(rail|light_rail|subway)$"](${bbox});
  way["aeroway"~"^(runway|taxiway|apron|aerodrome)$"](${bbox});
  relation["aeroway"~"^(runway|taxiway|apron|aerodrome)$"](${bbox});
  way["railway"~"^(yard|station)$"](${bbox});
  relation["railway"~"^(yard|station)$"](${bbox});
);
out geom;`
}

const buildWaterMaskQuery = (bounds: MapBounds) => {
  const bbox = boundsToBbox(bounds)

  return `
[out:json][timeout:35];
(
  way["natural"~"^(water|bay|strait)$"](${bbox});
  relation["natural"~"^(water|bay|strait)$"](${bbox});
  way["place"~"^(sea|ocean)$"](${bbox});
  relation["place"~"^(sea|ocean)$"](${bbox});
  way["water"](${bbox});
  relation["water"](${bbox});
  way["waterway"~"^(river|riverbank|dock|canal)$"](${bbox});
  relation["waterway"~"^(river|riverbank|dock|canal)$"](${bbox});
  way["landuse"~"^(reservoir|basin)$"](${bbox});
  relation["landuse"~"^(reservoir|basin)$"](${bbox});
);
out geom;`
}

const buildLandMaskQuery = (bounds: MapBounds) => {
  const bbox = boundsToBbox(bounds)

  return `
[out:json][timeout:45];
(
  way["landuse"~"^(railway|industrial|commercial|retail|cemetery)$"](${bbox});
  relation["landuse"~"^(railway|industrial|commercial|retail|cemetery)$"](${bbox});
  way["landuse"~"^(residential|allotments|education|institutional|recreation_ground|village_green)$"](${bbox});
  relation["landuse"~"^(residential|allotments|education|institutional|recreation_ground|village_green)$"](${bbox});
  way["landuse"~"^(grass|forest|meadow|greenfield)$"](${bbox});
  relation["landuse"~"^(grass|forest|meadow|greenfield)$"](${bbox});
  way["leisure"~"^(park|garden|recreation_ground|nature_reserve|playground|sports_centre|pitch)$"](${bbox});
  relation["leisure"~"^(park|garden|recreation_ground|nature_reserve|playground|sports_centre|pitch)$"](${bbox});
  way["natural"~"^(wood|scrub|grassland|heath|wetland)$"](${bbox});
  relation["natural"~"^(wood|scrub|grassland|heath|wetland)$"](${bbox});
  way["place"~"^(island|islet)$"](${bbox});
  relation["place"~"^(island|islet)$"](${bbox});
  way["amenity"="parking"](${bbox});
  relation["amenity"="parking"](${bbox});
  way["amenity"~"^(school|university|college|hospital|grave_yard)$"](${bbox});
  relation["amenity"~"^(school|university|college|hospital|grave_yard)$"](${bbox});
);
out geom;`
}

const buildBuildingLevelsQuery = (bounds: MapBounds) => {
  const bbox = boundsToBbox(bounds)

  return `
[out:json][timeout:35];
(
  way["building"](${bbox});
  relation["building"](${bbox});
);
out center tags;`
}

const GROCERY_SHOP_VALUES = new Set(['supermarket', 'grocery', 'greengrocer', 'convenience'])
const ALCOHOL_SHOP_VALUES = new Set(['alcohol', 'wine', 'beverages'])
const ALCOHOL_NAME_MARKERS = [
  'alcohol',
  'liquor',
  'wine',
  'beer',
  'craft beer',
  'spirits',
  'vodka',
  'whisky',
  'whiskey',
  'красное&белое',
  'красное & белое',
  'красное и белое',
  'винлаб',
  'winelab',
  'бристоль',
  'ароматный мир',
  'алко',
  'алкомаркет',
  'алкоголь',
  'вино',
  'винный',
  'пиво',
  'пивной',
  'пивная',
  'разливное',
]

const isGroceryShop = (tags: Record<string, string> = {}) => {
  const shop = tags.shop ?? ''
  const name = [tags.name, tags.brand, tags.operator].filter(Boolean).join(' ').toLowerCase()

  if (ALCOHOL_SHOP_VALUES.has(shop) || ALCOHOL_NAME_MARKERS.some((marker) => name.includes(marker))) {
    return false
  }

  return GROCERY_SHOP_VALUES.has(shop)
}

const categoryFromTags = (tags: Record<string, string> = {}): PoiCategory | null => {
  if (tags.leisure === 'park') {
    return 'parks'
  }

  if (isGroceryShop(tags)) {
    return 'groceries'
  }

  if (
    ['bar', 'pub', 'nightclub', 'music_venue'].includes(tags.amenity ?? '') ||
    tags.leisure === 'nightclub'
  ) {
    return 'noise'
  }

  if (
    ['station', 'stop_position'].includes(tags.public_transport ?? '') ||
    ['station', 'subway_entrance', 'tram_stop'].includes(tags.railway ?? '')
  ) {
    return 'transit'
  }

  return null
}

const elementToPoi = (element: OverpassElement, bounds = BOSTON_BOUNDS): Poi | null => {
  const category = categoryFromTags(element.tags)
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  const polygonRings = category === 'parks' || category === 'groceries' ? ringsFromOverpassElement(element) : []
  const areaSqm =
    category === 'parks' || category === 'groceries'
      ? polygonRings.reduce((total, points) => total + approximatePolygonAreaSqm(points, bounds), 0)
      : 0

  if (!category || lat === undefined || lng === undefined) {
    return null
  }

  return {
    id: `${element.type}-${element.id}`,
    category,
    shopKind: element.tags?.shop,
    lat,
    lng,
    name: element.tags?.name ?? CATEGORY_META[category].label,
    areaSqm,
    parkStrength: category === 'parks' ? parkStrengthFromArea(areaSqm) : 1,
    points: polygonRings[0],
  }
}

const elementToNoiseSegment = (element: OverpassElement): NoiseSegment | null => {
  const highway = element.tags?.highway
  const kind: NoiseSourceKind | null = element.tags?.aeroway
    ? 'airport'
    : element.tags?.railway
      ? 'rail'
      : highway && ['motorway', 'trunk', 'primary', 'secondary'].includes(highway)
        ? 'road'
        : null

  if (!kind || !element.geometry || element.geometry.length < 2) {
    return null
  }

  return {
    id: `${element.type}-${element.id}`,
    name: element.tags?.name ?? element.tags?.aeroway ?? element.tags?.railway ?? element.tags?.highway ?? kind,
    kind,
    roadClass: highway,
    points: element.geometry.map((point) => ({
      lat: point.lat,
      lng: point.lon,
    })),
  }
}

const overpassPointToLatLng = (point: OverpassGeometryPoint): LatLng => ({
  lat: point.lat,
  lng: point.lon,
})

const sameLatLng = (a: LatLng, b: LatLng) =>
  Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001

const normalizeRing = (points: LatLng[]) => {
  if (points.length > 1 && sameLatLng(points[0], points[points.length - 1])) {
    return points.slice(0, -1)
  }

  return points
}

const isClosedRing = (points: LatLng[]) =>
  points.length > 3 && sameLatLng(points[0], points[points.length - 1])

const stitchRings = (segments: LatLng[][]) => {
  const remaining = segments.map((segment) => [...segment])
  const rings: LatLng[][] = []

  while (remaining.length > 0) {
    const ring = remaining.shift() ?? []
    let changed = true

    while (changed && ring.length > 0) {
      changed = false

      for (let index = 0; index < remaining.length; index += 1) {
        const segment = remaining[index]
        const ringStart = ring[0]
        const ringEnd = ring[ring.length - 1]
        const segmentStart = segment[0]
        const segmentEnd = segment[segment.length - 1]

        if (sameLatLng(ringEnd, segmentStart)) {
          ring.push(...segment.slice(1))
        } else if (sameLatLng(ringEnd, segmentEnd)) {
          ring.push(...segment.slice(0, -1).reverse())
        } else if (sameLatLng(ringStart, segmentEnd)) {
          ring.unshift(...segment.slice(0, -1))
        } else if (sameLatLng(ringStart, segmentStart)) {
          ring.unshift(...segment.slice(1).reverse())
        } else {
          continue
        }

        remaining.splice(index, 1)
        changed = true
        break
      }
    }

    if (isClosedRing(ring)) {
      const normalizedRing = normalizeRing(ring)
      rings.push(normalizedRing)
    }
  }

  return rings
}

const ringsFromOverpassElement = (element: OverpassElement) => {
  return polygonAreasFromOverpassElement(element).map((area) => area.points)
}

const pointInLatLngRing = (point: LatLng, ring: LatLng[]) =>
  pointInPolygon(
    point.lng,
    point.lat,
    ring.map((ringPoint) => ({ x: ringPoint.lng, y: ringPoint.lat })),
  )

const polygonAreasFromOverpassElement = (element: OverpassElement) => {
  if (
    element.geometry &&
    element.geometry.length >= 4 &&
    isClosedRing(element.geometry.map(overpassPointToLatLng))
  ) {
    return [{ points: normalizeRing(element.geometry.map(overpassPointToLatLng)), holes: [] }]
  }

  const outerSegments =
    element.members
      ?.filter((member) => member.role !== 'inner' && member.geometry && member.geometry.length >= 2)
      .map((member) => member.geometry?.map(overpassPointToLatLng) ?? []) ?? []
  const innerSegments =
    element.members
      ?.filter((member) => member.role === 'inner' && member.geometry && member.geometry.length >= 2)
      .map((member) => member.geometry?.map(overpassPointToLatLng) ?? []) ?? []
  const innerRings = stitchRings(innerSegments)

  return stitchRings(outerSegments).map((points) => ({
    points,
    holes: innerRings.filter((hole) => hole[0] && pointInLatLngRing(hole[0], points)),
  }))
}

const HARD_WATER_VALUES = new Set([
  'basin',
  'canal',
  'dock',
  'lagoon',
  'lake',
  'moat',
  'oxbow',
  'pond',
  'reflecting_pool',
  'reservoir',
  'river',
  'stream_pool',
])

const SURFACE_WATERWAYS = new Set(['canal', 'dock', 'river', 'riverbank'])

const isCoveredOrUnderground = (tags: Record<string, string>) =>
  tags.location === 'underground' ||
  tags.covered === 'yes' ||
  (tags.tunnel !== undefined && tags.tunnel !== 'no')

const landPenaltyTemplateFromTags = (
  tags: Record<string, string>,
): Pick<LandPenaltyArea, 'kind' | 'maxScore'> | null => {
  const isWater =
    tags.natural === 'water' ||
    tags.natural === 'bay' ||
    tags.natural === 'strait' ||
    tags.place === 'sea' ||
    tags.place === 'ocean' ||
    (tags.water !== undefined && HARD_WATER_VALUES.has(tags.water)) ||
    (SURFACE_WATERWAYS.has(tags.waterway ?? '') && !isCoveredOrUnderground(tags)) ||
    tags.landuse === 'reservoir' ||
    tags.landuse === 'basin'

  if (isWater) {
    return {
      kind: 'water',
      maxScore: 0,
    }
  }

  if (tags.aeroway) {
    return {
      kind: 'airport',
      maxScore: 0,
    }
  }

  if (tags.railway === 'yard' || tags.railway === 'station' || tags.landuse === 'railway') {
    return {
      kind: 'rail-yard',
      maxScore: 0,
    }
  }

  if (tags.landuse === 'industrial') {
    return {
      kind: 'industrial',
      maxScore: 0,
    }
  }

  if (tags.amenity === 'parking') {
    return {
      kind: 'parking',
      maxScore: 0,
    }
  }

  if (tags.highway) {
    return {
      kind: 'road',
      maxScore: 0,
    }
  }

  if (tags.landuse === 'commercial' || tags.landuse === 'retail') {
    return {
      kind: 'commercial',
      maxScore: 0.42,
    }
  }

  if (
    ['school', 'university', 'college', 'hospital'].includes(tags.amenity ?? '') ||
    ['education', 'institutional'].includes(tags.landuse ?? '')
  ) {
    return {
      kind: 'civic',
      maxScore: 0,
    }
  }

  if (tags.landuse === 'cemetery' || tags.amenity === 'grave_yard') {
    return {
      kind: 'cemetery',
      maxScore: 0,
    }
  }

  if (tags.landuse === 'residential') {
    return {
      kind: 'residential',
      maxScore: 1,
    }
  }

  if (['island', 'islet'].includes(tags.place ?? '')) {
    return {
      kind: 'land',
      maxScore: 1,
    }
  }

  if (
    ['allotments', 'grass', 'forest', 'meadow', 'greenfield', 'recreation_ground', 'village_green'].includes(
      tags.landuse ?? '',
    ) ||
    ['park', 'garden', 'recreation_ground', 'nature_reserve', 'playground', 'sports_centre', 'pitch'].includes(
      tags.leisure ?? '',
    ) ||
    ['wood', 'scrub', 'grassland', 'heath', 'wetland'].includes(tags.natural ?? '')
  ) {
    return {
      kind: 'open-space',
      maxScore: 0.48,
    }
  }

  return null
}

const elementToLandPenaltyAreas = (element: OverpassElement): LandPenaltyArea[] => {
  const tags = element.tags ?? {}
  const template = landPenaltyTemplateFromTags(tags)

  if (!template) {
    return []
  }

  const geometryPoints = element.geometry?.map(overpassPointToLatLng) ?? []
  const isLinearRoad =
    template.kind === 'road' &&
    geometryPoints.length >= 2 &&
    !sameLatLng(geometryPoints[0], geometryPoints[geometryPoints.length - 1])
  const isLinearWater =
    template.kind === 'water' &&
    geometryPoints.length >= 2 &&
    !sameLatLng(geometryPoints[0], geometryPoints[geometryPoints.length - 1])

  if (isLinearRoad) {
    return [
      {
        id: `${element.type}-${element.id}-road-surface`,
        name: tags.name ?? tags.highway ?? 'road',
        kind: 'road',
        points: geometryPoints,
        maxScore: 0,
        isLinear: true,
        bufferMeters: ROAD_SURFACE_NO_GO_BUFFER_METERS,
      },
    ]
  }

  if (isLinearWater) {
    const bufferMeters =
      tags.waterway === 'river' || tags.waterway === 'riverbank'
        ? 35
        : tags.waterway === 'dock'
          ? 28
          : 18

    return [
      {
        id: `${element.type}-${element.id}-water-line`,
        name: tags.name ?? tags.waterway ?? 'water',
        kind: 'water',
        points: geometryPoints,
        maxScore: 0,
        isLinear: true,
        bufferMeters,
      },
    ]
  }

  return polygonAreasFromOverpassElement(element).map((area, index) => ({
    id: `${element.type}-${element.id}-${index}`,
    name:
      tags.name ??
      tags.aeroway ??
      tags.railway ??
      tags.landuse ??
      tags.amenity ??
      tags.natural ??
      template.kind,
    kind: template.kind,
    points: area.points,
    holes: area.holes,
    maxScore: template.maxScore,
  }))
}

const parseNumericTag = (value: string | undefined) => {
  if (!value) {
    return null
  }

  const parsed = Number(value.replace(/[^\d.]/g, ''))

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const classifyBuildingUse = (tags: Record<string, string> = {}): BuildingFootprint['use'] => {
  const building = tags.building
  const residentialTypes = new Set([
    'apartments',
    'bungalow',
    'cabin',
    'detached',
    'dormitory',
    'duplex',
    'farm',
    'ger',
    'house',
    'houseboat',
    'residential',
    'semidetached_house',
    'static_caravan',
    'terrace',
  ])
  const nonResidentialTypes = new Set([
    'commercial',
    'construction',
    'civic',
    'college',
    'garage',
    'garages',
    'greenhouse',
    'hangar',
    'hospital',
    'hotel',
    'industrial',
    'kiosk',
    'office',
    'parking',
    'public',
    'retail',
    'roof',
    'school',
    'service',
    'shed',
    'sports_hall',
    'stadium',
    'train_station',
    'transportation',
    'university',
    'warehouse',
  ])

  if (building && residentialTypes.has(building)) {
    return 'residential'
  }

  if (building && nonResidentialTypes.has(building)) {
    return 'nonResidential'
  }

  if (tags['addr:unit'] || tags['addr:flats']) {
    return 'residential'
  }

  return 'unknown'
}

const elementToBuildingFootprint = (element: OverpassElement): BuildingFootprint | null => {
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  const levels = parseNumericTag(element.tags?.['building:levels'])
  const heightMeters = parseNumericTag(element.tags?.height)
  const inferredLevels = levels ?? (heightMeters ? Math.max(1, Math.round(heightMeters / 3.1)) : null)

  if (lat === undefined || lng === undefined) {
    return null
  }

  return {
    id: `${element.type}-${element.id}`,
    name: element.tags?.name ?? 'Building',
    use: classifyBuildingUse(element.tags),
    lat,
    lng,
    levels: inferredLevels,
    heightMeters,
  }
}

const fetchPois = async (signal: AbortSignal, bounds: MapBounds, force = false) => {
  const payload = await cachedRequest<{ elements?: OverpassElement[] }>(
    `pois:${boundsCachePart(bounds)}`,
    () => fetchOverpassJson(buildOverpassQuery(bounds), signal, 'pois'),
    { force },
  )
  const seen = new Set<string>()

  return (payload.elements ?? [])
    .map((element) => elementToPoi(element, bounds))
    .filter((poi): poi is Poi => Boolean(poi))
    .filter((poi) => {
      const key = `${poi.category}-${poi.lat.toFixed(5)}-${poi.lng.toFixed(5)}`

      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

const fetchNoiseSegments = async (signal: AbortSignal, bounds: MapBounds, force = false) => {
  const boundsKey = boundsCachePart(bounds)
  const payloadResults = await Promise.allSettled([
    cachedRequest<{ elements?: OverpassElement[] }>(
      `masks-transport:${boundsKey}`,
      () => fetchOverpassJson(buildTransportMaskQuery(bounds), signal, 'transport masks'),
      { force },
    ),
    cachedRequest<{ elements?: OverpassElement[] }>(
      `masks-water:${boundsKey}`,
      () => fetchOverpassJson(buildWaterMaskQuery(bounds), signal, 'water masks'),
      { force },
    ),
    cachedRequest<{ elements?: OverpassElement[] }>(
      `masks-land:${boundsKey}`,
      () => fetchOverpassJson(buildLandMaskQuery(bounds), signal, 'land masks'),
      { force },
    ),
  ])
  const elements = payloadResults.flatMap((result) =>
    result.status === 'fulfilled' ? (result.value.elements ?? []) : [],
  )

  if (elements.length === 0 && payloadResults.every((result) => result.status === 'rejected')) {
    throw new Error('OSM masks unavailable')
  }

  return {
    segments: elements
      .map(elementToNoiseSegment)
      .filter((segment): segment is NoiseSegment => Boolean(segment)),
    areas: elements.flatMap(elementToLandPenaltyAreas),
  }
}

const buildingPriority = (building: BuildingFootprint) => {
  if (building.use === 'residential') {
    return 0
  }

  if (building.levels !== null || building.heightMeters !== null) {
    return 1
  }

  if (building.use === 'nonResidential') {
    return 2
  }

  return 3
}

const fetchBuildingFootprints = async (
  signal: AbortSignal,
  bounds: MapBounds,
  force = false,
): Promise<BuildingFetchResult> => {
  const payload = await cachedRequest<{ elements?: OverpassElement[] }>(
    `building-levels:${boundsCachePart(bounds)}`,
    () => fetchOverpassJson(buildBuildingLevelsQuery(bounds), signal, 'buildings'),
    { force },
  )
  const buildings = (payload.elements ?? [])
    .map(elementToBuildingFootprint)
    .filter((building): building is BuildingFootprint => Boolean(building))
  const isCapped = buildings.length > BUILDING_STORE_LIMIT

  return {
    buildings: isCapped
      ? [...buildings]
          .sort((first, second) => buildingPriority(first) - buildingPriority(second))
          .slice(0, BUILDING_STORE_LIMIT)
      : buildings,
    total: buildings.length,
    isCapped,
  }
}

const fetchCrimeIncidents = async (signal: AbortSignal, bounds: MapBounds, force = false) => {
  const sql = `
SELECT "_id", "INCIDENT_NUMBER", "OFFENSE_DESCRIPTION", "UCR_PART", "Lat", "Long"
FROM "${CRIME_RESOURCE_ID}"
WHERE "YEAR" = '2026'
  AND "Lat" IS NOT NULL
  AND "Long" IS NOT NULL
ORDER BY "OCCURRED_ON_DATE" DESC
LIMIT 30000`
  const url = dataEndpoint(
    '/api/boston-crime/api/3/action/datastore_search_sql',
    'https://data.boston.gov/api/3/action/datastore_search_sql',
  )

  url.searchParams.set('sql', sql)

  const payload = await cachedRequest<{
    success?: boolean
    result?: {
      records?: CrimeRecord[]
    }
  }>(
    `crime:${boundsCachePart(bounds)}`,
    async () => {
      const response = await fetch(url, { signal })

      if (!response.ok) {
        throw new Error(`Boston crime ${response.status}`)
      }

      return (await response.json()) as {
        success?: boolean
        result?: {
          records?: CrimeRecord[]
        }
      }
    },
    { force },
  )

  if (!payload.success) {
    throw new Error('crime dataset unavailable')
  }

  return (payload.result?.records ?? [])
    .map((record): CrimeIncident | null => {
      const lat = Number(record.Lat)
      const lng = Number(record.Long)

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < bounds.south ||
        lat > bounds.north ||
        lng < bounds.west ||
        lng > bounds.east
      ) {
        return null
      }

      return {
        id: record.INCIDENT_NUMBER ?? String(record._id),
        lat,
        lng,
        category: record.UCR_PART ?? 'Incident',
        description: record.OFFENSE_DESCRIPTION ?? 'Incident',
      }
    })
    .filter((incident): incident is CrimeIncident => Boolean(incident))
}

const fetchTrafficSegments = async (signal: AbortSignal, bounds: MapBounds, force = false) => {
  const segments: TrafficSegment[] = []
  const pageSize = 2000

  for (let offset = 0; offset < 8000; offset += pageSize) {
    const url = dataEndpoint(
      '/api/massdot/arcgis/rest/services/Roads/RoadInventoryLRS/FeatureServer/56/query',
      'https://gisstg.massdot.state.ma.us/arcgis/rest/services/Roads/RoadInventoryLRS/FeatureServer/56/query',
    )

    url.searchParams.set('f', 'json')
    url.searchParams.set('where', 'AADT > 0')
    url.searchParams.set(
      'geometry',
      `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    )
    url.searchParams.set('geometryType', 'esriGeometryEnvelope')
    url.searchParams.set('inSR', '4326')
    url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
    url.searchParams.set('outFields', 'OBJECTID,AADT,AADT_Year')
    url.searchParams.set('returnGeometry', 'true')
    url.searchParams.set('outSR', '4326')
    url.searchParams.set('resultOffset', String(offset))
    url.searchParams.set('resultRecordCount', String(pageSize))

    const payload = await cachedRequest<{
      features?: ArcGisPolylineFeature[]
      error?: unknown
    }>(
      `traffic:${boundsCachePart(bounds)}:${offset}`,
      async () => {
        const response = await fetch(url, { signal })

        if (!response.ok) {
          throw new Error(`MassDOT traffic ${response.status}`)
        }

        return (await response.json()) as {
          features?: ArcGisPolylineFeature[]
          error?: unknown
        }
      },
      { force },
    )

    if (payload.error) {
      throw new Error('traffic dataset unavailable')
    }

    const features = payload.features ?? []

    for (const feature of features) {
      const attributes = feature.attributes
      const aadt = Number(attributes?.AADT)
      const points =
        feature.geometry?.paths?.flatMap((path) =>
          path
            .map(([lng, lat]) => ({ lat, lng }))
            .filter(
              (point) =>
                Number.isFinite(point.lat) &&
                Number.isFinite(point.lng) &&
                point.lat >= bounds.south &&
                point.lat <= bounds.north &&
                point.lng >= bounds.west &&
                point.lng <= bounds.east,
            ),
        ) ?? []

      if (!attributes || !Number.isFinite(aadt) || aadt <= 0 || points.length < 2) {
        continue
      }

      segments.push({
        id: String(attributes.OBJECTID),
        aadt,
        year: attributes.AADT_Year ?? undefined,
        points,
      })
    }

    if (features.length < pageSize) {
      break
    }
  }

  return segments
}

const inferredAadtFromRoadClass = (roadClass?: string) => {
  if (roadClass === 'motorway') {
    return 82_000
  }

  if (roadClass === 'trunk') {
    return 58_000
  }

  if (roadClass === 'primary') {
    return 36_000
  }

  if (roadClass === 'secondary') {
    return 18_000
  }

  return 9_000
}

const trafficSegmentsFromOsmRoads = (segments: NoiseSegment[]): TrafficSegment[] =>
  segments
    .filter((segment) => segment.kind === 'road' && segment.points.length >= 2)
    .map((segment) => ({
      id: `osm-${segment.id}`,
      aadt: inferredAadtFromRoadClass(segment.roadClass),
      points: segment.points,
    }))

const scoreByDistance = (distance: number, criterion: Criterion) => {
  if (!Number.isFinite(distance)) {
    return 0.5
  }

  if (criterion.mode === 'centerAccess') {
    if (distance <= 1.5) {
      return 1
    }

    if (distance <= 3) {
      return 1 - ((distance - 1.5) / 1.5) * 0.28
    }

    if (distance <= 6) {
      return 0.72 - ((distance - 3) / 3) * 0.42
    }

    if (distance <= criterion.thresholdKm) {
      return 0.3 - ((distance - 6) / Math.max(1, criterion.thresholdKm - 6)) * 0.2
    }

    return Math.max(0, 0.1 * (1 - (distance - criterion.thresholdKm) / 8))
  }

  const normalized = clamp(distance / criterion.thresholdKm)

  return criterion.mode === 'nearIsGood' ? 1 - normalized : normalized
}

const projectPoi = (
  poi: Poi,
  bounds = BOSTON_BOUNDS,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
): ProjectedPoi => ({
  ...latLngToMeters(poi, bounds, metersPerDegreeLng),
  shopKind: poi.shopKind,
  areaSqm: poi.areaSqm ?? 0,
  parkStrength: poi.parkStrength ?? parkStrengthFromArea(poi.areaSqm),
})

const parkInfluenceScore = (x: number, y: number, parks: ProjectedPoi[], criterion: Criterion) => {
  if (parks.length === 0) {
    return 0
  }

  let bestScore = 0

  for (const park of parks) {
    const distanceMeters = Math.hypot(x - park.x, y - park.y)
    const equivalentRadius = Math.sqrt(Math.max(0, park.areaSqm) / Math.PI)
    const coreRadius = Math.min(350, equivalentRadius * 0.45)
    const reachMeters = criterion.thresholdKm * 1000 * (0.18 + park.parkStrength * 0.82)
    const distanceScore = clamp(1 - Math.max(0, distanceMeters - coreRadius) / reachMeters)
    const score = park.parkStrength * distanceScore

    if (score > bestScore) {
      bestScore = score
    }
  }

  return clamp(bestScore)
}

const projectedPointBounds = (points: Array<{ x: number; y: number }>) => {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    if (point.x < minX) {
      minX = point.x
    }

    if (point.x > maxX) {
      maxX = point.x
    }

    if (point.y < minY) {
      minY = point.y
    }

    if (point.y > maxY) {
      maxY = point.y
    }
  }

  return { minX, maxX, minY, maxY }
}

const grocerySupplyWeight = (grocery: Pick<ProjectedPoi, 'areaSqm' | 'shopKind'>) => {
  if (grocery.shopKind === 'supermarket') {
    if (grocery.areaSqm >= 2500) {
      return 5
    }

    if (grocery.areaSqm >= 1200) {
      return 4
    }

    return 3
  }

  if (grocery.shopKind === 'grocery') {
    return grocery.areaSqm >= 450 ? 1.5 : 1
  }

  return 0.85
}

const grocerySupplyDetail = (
  x: number,
  y: number,
  groceries: ProjectedPoi[],
  criterion: Criterion,
) => {
  const reachMeters = criterion.thresholdKm * 1000
  let weightedSupply = 0
  let nearbyCount = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const grocery of groceries) {
    const distanceMeters = Math.hypot(x - grocery.x, y - grocery.y)

    if (distanceMeters < nearestDistance) {
      nearestDistance = distanceMeters
    }

    if (distanceMeters > reachMeters) {
      continue
    }

    nearbyCount += 1
    weightedSupply += grocerySupplyWeight(grocery) * Math.pow(1 - distanceMeters / reachMeters, 1.35)
  }

  return {
    nearbyCount,
    nearestDistance,
    score: clamp(weightedSupply / 7.5),
    weightedSupply,
  }
}

const grocerySupplyScore = (x: number, y: number, groceries: ProjectedPoi[], criterion: Criterion) =>
  grocerySupplyDetail(x, y, groceries, criterion).score

const noiseSegmentRadius = (kind: NoiseSourceKind) => {
  if (kind === 'airport') {
    return {
      hard: AIRPORT_HARD_NOISE_METERS,
      soft: AIRPORT_SOFT_NOISE_METERS,
    }
  }

  if (kind === 'rail') {
    return {
      hard: RAIL_HARD_NOISE_METERS,
      soft: RAIL_SOFT_NOISE_METERS,
    }
  }

  return {
    hard: MAJOR_ROAD_HARD_NOISE_METERS,
    soft: MAJOR_ROAD_SOFT_NOISE_METERS,
  }
}

const transportNoiseScore = (distanceMeters: number, kind: NoiseSourceKind) => {
  if (!Number.isFinite(distanceMeters)) {
    return 1
  }

  const radius = noiseSegmentRadius(kind)
  const floorScore = kind === 'airport' ? 0.06 : kind === 'rail' ? 0.28 : 0.38

  if (distanceMeters <= radius.hard) {
    return floorScore
  }

  const recovery = clamp((distanceMeters - radius.hard) / (radius.soft - radius.hard))

  return clamp(floorScore + Math.pow(recovery, 0.68) * (1 - floorScore))
}

const trafficPressure = (aadt: number) => clamp(Math.log1p(aadt) / Math.log1p(TRAFFIC_MAX_AADT))

const trafficNoiseScore = (distanceMeters: number, aadt: number) => {
  const pressure = trafficPressure(aadt)
  const hard = 20 + pressure * 35
  const soft = 90 + pressure * 300
  const floorScore = clamp(0.72 - pressure * 0.42, 0.3, 0.72)

  if (distanceMeters <= hard) {
    return floorScore
  }

  const recovery = clamp((distanceMeters - hard) / (soft - hard))

  return clamp(floorScore + Math.pow(recovery, 0.72) * (1 - floorScore))
}

const buildSpatialFactorField = (
  poisByCategory: Record<PoiCategory, Poi[]>,
  crimeIncidents: CrimeIncident[],
  registryRiskPoints: RegistryRiskPoint[],
  noiseSegments: NoiseSegment[],
  landPenaltyAreas: LandPenaltyArea[],
  trafficSegments: TrafficSegment[],
  bounds: MapBounds,
  boundaryAreas: CityConfig['boundaryAreas'],
  centerPoint: LatLng,
  cellSizeMeters: number,
): SpatialFactorField => {
  const metersPerDegreeLng = metersPerDegreeLngForBounds(bounds)
  const project = (point: LatLng) => latLngToMeters(point, bounds, metersPerDegreeLng)
  const widthMeters = (bounds.east - bounds.west) * metersPerDegreeLng
  const heightMeters = (bounds.north - bounds.south) * METERS_PER_DEGREE_LAT
  const cols = Math.ceil(widthMeters / cellSizeMeters)
  const rows = Math.ceil(heightMeters / cellSizeMeters)
  const cellCount = cols * rows
  const crimeRadiusCells = Math.max(1, Math.ceil(CRIME_RADIUS_METERS / cellSizeMeters))
  const registryRadiusCells = Math.max(1, Math.ceil(REGISTRY_RISK_RADIUS_METERS / cellSizeMeters))
  const crimeBins = new Uint16Array(cellCount)
  const crimeDensity = new Float32Array(cellCount)
  const registryBins = new Float32Array(cellCount)
  const registryDensity = new Float32Array(cellCount)
  const transportNoiseByCell = new Float32Array(cellCount)
  const landScoreCapByCell = new Float32Array(cellCount)
  const waterMaskByCell = new Uint8Array(cellCount)
  const roadMaskByCell = new Uint8Array(cellCount)
  const noGoMaskByCell = new Uint8Array(cellCount)
  const overlayInclusionMaskByCell = new Uint8Array(cellCount)
  const overlayExclusionMaskByCell = new Uint8Array(cellCount)
  const cityBoundaryMaskByCell = new Uint8Array(cellCount)
  const landProxySeedMaskByCell = new Uint8Array(cellCount)
  const residentialCandidateMaskByCell = new Uint8Array(cellCount)
  const factorScores = {
    parks: new Float32Array(cellCount),
    groceries: new Float32Array(cellCount),
    noise: new Float32Array(cellCount),
    transit: new Float32Array(cellCount),
    center: new Float32Array(cellCount),
    crime: new Float32Array(cellCount),
    registry: new Float32Array(cellCount),
  } satisfies Record<CriterionId, Float32Array>
  const projectedPois = {
    parks: poisByCategory.parks.map((poi) => projectPoi(poi, bounds, metersPerDegreeLng)),
    groceries: poisByCategory.groceries.map((poi) => projectPoi(poi, bounds, metersPerDegreeLng)),
    noise: poisByCategory.noise.map((poi) => projectPoi(poi, bounds, metersPerDegreeLng)),
    transit: poisByCategory.transit.map((poi) => projectPoi(poi, bounds, metersPerDegreeLng)),
  } satisfies Record<PoiCategory, ProjectedPoi[]>
  const projectedNoiseSegments = noiseSegments.map((segment) => ({
    kind: segment.kind,
    points: segment.points.map(project),
  }))
  const projectedLandPenaltyAreas = landPenaltyAreas.map((area) => ({
    kind: area.kind,
    maxScore: area.maxScore,
    isLinear: area.isLinear,
    bufferMeters: area.bufferMeters,
    points: area.points.map(project),
    holes: area.holes?.map((hole) => hole.map(project)) ?? [],
  }))
  const projectedBoundaryAreas =
    boundaryAreas?.map((area) => ({
      points: area.points.map(project),
      holes: area.holes?.map((hole) => hole.map(project)) ?? [],
    })) ?? []
  const islandLandAreas = landPenaltyAreas.filter((area) => area.kind === 'land' && area.points.length >= 3)
  const overlayExclusionAreas = [
    ...landPenaltyAreas
      .filter((area) => area.kind === 'water' && area.points.length >= 3)
      .map((area) => ({
        points: area.points,
        holes: [
          ...(area.holes ?? []),
          ...islandLandAreas
            .filter((island) => island.points[0] && pointInLatLngRing(island.points[0], area.points))
            .map((island) => island.points),
        ],
      })),
    ...poisByCategory.parks
      .filter((park) => park.points && park.points.length >= 3)
      .map((park) => ({ points: park.points ?? [] })),
  ]
  const overlayExclusionLines = landPenaltyAreas
    .filter(
      (area): area is LandPenaltyArea & { kind: 'road' | 'water'; bufferMeters: number } =>
        Boolean(area.isLinear) &&
        (area.kind === 'road' || area.kind === 'water') &&
        Boolean(area.bufferMeters) &&
        area.points.length >= 2,
    )
    .map((area) => ({
      points: area.points,
      bufferMeters: area.bufferMeters,
      kind: area.kind,
    }))
  const noGoOverlayAreas = landPenaltyAreas
    .filter(
      (area) =>
        !area.isLinear &&
        !(['water', 'road', 'open-space'] as LandPenaltyArea['kind'][]).includes(area.kind) &&
        area.maxScore <= 0 &&
        area.points.length >= 3,
    )
    .map((area) => area.points)
  const projectedParkAreas = poisByCategory.parks
    .filter((park) => park.points && park.points.length >= 3)
    .map((park) => park.points?.map(project) ?? [])
  const projectedTrafficSegments = trafficSegments.map((segment) => ({
    aadt: segment.aadt,
    points: segment.points.map(project),
  }))
  const center = project(centerPoint)
  const criteriaById = Object.fromEntries(INITIAL_CRITERIA.map((criterion) => [criterion.id, criterion])) as Record<
    CriterionId,
    Criterion
  >

  transportNoiseByCell.fill(1)
  landScoreCapByCell.fill(1)
  cityBoundaryMaskByCell.fill(projectedBoundaryAreas.length > 0 ? 0 : 1)

  if (projectedBoundaryAreas.length > 0) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < cols; column += 1) {
        const x = column * cellSizeMeters + cellSizeMeters / 2
        const y = row * cellSizeMeters + cellSizeMeters / 2
        const index = row * cols + column
        const isInsideCity = projectedBoundaryAreas.some(
          (area) =>
            pointInPolygon(x, y, area.points) &&
            !area.holes.some((hole) => pointInPolygon(x, y, hole)),
        )

        if (isInsideCity) {
          cityBoundaryMaskByCell[index] = 1
          overlayInclusionMaskByCell[index] = 1
        } else {
          overlayExclusionMaskByCell[index] = 1
          landScoreCapByCell[index] = 0
        }
      }
    }
  }

  for (const incident of crimeIncidents) {
    const point = project(incident)
    const column = Math.floor(point.x / cellSizeMeters)
    const row = Math.floor(point.y / cellSizeMeters)

    if (column >= 0 && column < cols && row >= 0 && row < rows) {
      crimeBins[row * cols + column] += 1
    }
  }

  for (const registryPoint of registryRiskPoints) {
    const point = project(registryPoint)
    const column = Math.floor(point.x / cellSizeMeters)
    const row = Math.floor(point.y / cellSizeMeters)

    if (column >= 0 && column < cols && row >= 0 && row < rows) {
      registryBins[row * cols + column] += registryPoint.weight
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      let density = 0

      for (let dy = -crimeRadiusCells; dy <= crimeRadiusCells; dy += 1) {
        for (let dx = -crimeRadiusCells; dx <= crimeRadiusCells; dx += 1) {
          const sourceColumn = column + dx
          const sourceRow = row + dy

          if (sourceColumn < 0 || sourceColumn >= cols || sourceRow < 0 || sourceRow >= rows) {
            continue
          }

          const distanceCells = Math.hypot(dx, dy)

          if (distanceCells > crimeRadiusCells) {
            continue
          }

          const weight = Math.exp(-(distanceCells * distanceCells) / 1.8)
          density += crimeBins[sourceRow * cols + sourceColumn] * weight
        }
      }

      crimeDensity[row * cols + column] = density
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      let density = 0

      for (let dy = -registryRadiusCells; dy <= registryRadiusCells; dy += 1) {
        for (let dx = -registryRadiusCells; dx <= registryRadiusCells; dx += 1) {
          const sourceColumn = column + dx
          const sourceRow = row + dy

          if (sourceColumn < 0 || sourceColumn >= cols || sourceRow < 0 || sourceRow >= rows) {
            continue
          }

          const distanceCells = Math.hypot(dx, dy)

          if (distanceCells > registryRadiusCells) {
            continue
          }

          const weight = Math.exp(-(distanceCells * distanceCells) / 2.2)
          density += registryBins[sourceRow * cols + sourceColumn] * weight
        }
      }

      registryDensity[row * cols + column] = density
    }
  }

  for (const segment of projectedNoiseSegments) {
    const radius = noiseSegmentRadius(segment.kind)

    for (let pointIndex = 1; pointIndex < segment.points.length; pointIndex += 1) {
      const start = segment.points[pointIndex - 1]
      const end = segment.points[pointIndex]
      const minX = Math.min(start.x, end.x) - radius.soft
      const maxX = Math.max(start.x, end.x) + radius.soft
      const minY = Math.min(start.y, end.y) - radius.soft
      const maxY = Math.max(start.y, end.y) + radius.soft
      const minColumn = Math.max(0, Math.floor(minX / cellSizeMeters))
      const maxColumn = Math.min(cols - 1, Math.floor(maxX / cellSizeMeters))
      const minRow = Math.max(0, Math.floor(minY / cellSizeMeters))
      const maxRow = Math.min(rows - 1, Math.floor(maxY / cellSizeMeters))

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const x = column * cellSizeMeters + cellSizeMeters / 2
          const y = row * cellSizeMeters + cellSizeMeters / 2
          const distance = pointToSegmentDistanceMeters(x, y, start, end)
          const score = transportNoiseScore(distance, segment.kind)
          const index = row * cols + column

          if (score < transportNoiseByCell[index]) {
            transportNoiseByCell[index] = score
          }

          if (segment.kind === 'road' && distance <= 90) {
            landProxySeedMaskByCell[index] = 1
          }
        }
      }
    }
  }

  for (const segment of projectedTrafficSegments) {
    const pressure = trafficPressure(segment.aadt)
    const softRadius = 80 + pressure * 420

    for (let pointIndex = 1; pointIndex < segment.points.length; pointIndex += 1) {
      const start = segment.points[pointIndex - 1]
      const end = segment.points[pointIndex]
      const minX = Math.min(start.x, end.x) - softRadius
      const maxX = Math.max(start.x, end.x) + softRadius
      const minY = Math.min(start.y, end.y) - softRadius
      const maxY = Math.max(start.y, end.y) + softRadius
      const minColumn = Math.max(0, Math.floor(minX / cellSizeMeters))
      const maxColumn = Math.min(cols - 1, Math.floor(maxX / cellSizeMeters))
      const minRow = Math.max(0, Math.floor(minY / cellSizeMeters))
      const maxRow = Math.min(rows - 1, Math.floor(maxY / cellSizeMeters))

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const x = column * cellSizeMeters + cellSizeMeters / 2
          const y = row * cellSizeMeters + cellSizeMeters / 2
          const distance = pointToSegmentDistanceMeters(x, y, start, end)
          const score = trafficNoiseScore(distance, segment.aadt)
          const index = row * cols + column

          if (score < transportNoiseByCell[index]) {
            transportNoiseByCell[index] = score
          }

          if (distance <= 120) {
            landProxySeedMaskByCell[index] = 1
          }
        }
      }
    }
  }

  for (const area of projectedLandPenaltyAreas) {
    const { minX, maxX, minY, maxY } = projectedPointBounds(area.points)
    const areaBuffer = area.isLinear ? (area.bufferMeters ?? 0) : 0
    const minColumn = Math.max(0, Math.floor((minX - areaBuffer) / cellSizeMeters))
    const maxColumn = Math.min(cols - 1, Math.floor((maxX + areaBuffer) / cellSizeMeters))
    const minRow = Math.max(0, Math.floor((minY - areaBuffer) / cellSizeMeters))
    const maxRow = Math.min(rows - 1, Math.floor((maxY + areaBuffer) / cellSizeMeters))

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = column * cellSizeMeters + cellSizeMeters / 2
        const y = row * cellSizeMeters + cellSizeMeters / 2

        let isInsideArea =
          pointInPolygon(x, y, area.points) &&
          !area.holes.some((hole) => pointInPolygon(x, y, hole))

        if (area.isLinear) {
          isInsideArea = false

          for (let pointIndex = 1; pointIndex < area.points.length; pointIndex += 1) {
            if (
              pointToSegmentDistanceMeters(
                x,
                y,
                area.points[pointIndex - 1],
                area.points[pointIndex],
              ) <= areaBuffer
            ) {
              isInsideArea = true
              break
            }
          }
        }

        if (!isInsideArea) {
          continue
        }

        const index = row * cols + column

        if (area.kind === 'water') {
          waterMaskByCell[index] = 1
          overlayExclusionMaskByCell[index] = 1
        } else if (area.kind === 'road') {
          roadMaskByCell[index] = 1
          overlayExclusionMaskByCell[index] = 1
          landProxySeedMaskByCell[index] = 1
        } else if (area.kind === 'open-space') {
          landProxySeedMaskByCell[index] = 1
        } else {
          if (area.kind === 'land' && waterMaskByCell[index]) {
            waterMaskByCell[index] = 0

            if (!roadMaskByCell[index] && !noGoMaskByCell[index]) {
              overlayExclusionMaskByCell[index] = 0
              landScoreCapByCell[index] = Math.max(landScoreCapByCell[index], area.maxScore)
            }
          }

          overlayInclusionMaskByCell[index] = 1
          landProxySeedMaskByCell[index] = 1

          if (area.kind === 'residential') {
            residentialCandidateMaskByCell[index] = 1
          }

          if (area.maxScore <= 0) {
            noGoMaskByCell[index] = 1
          }
        }

        if (area.kind !== 'road' && area.maxScore < landScoreCapByCell[index]) {
          landScoreCapByCell[index] = area.maxScore
        }
      }
    }
  }

  for (const parkArea of projectedParkAreas) {
    const { minX, maxX, minY, maxY } = projectedPointBounds(parkArea)
    const minColumn = Math.max(0, Math.floor(minX / cellSizeMeters))
    const maxColumn = Math.min(cols - 1, Math.floor(maxX / cellSizeMeters))
    const minRow = Math.max(0, Math.floor(minY / cellSizeMeters))
    const maxRow = Math.min(rows - 1, Math.floor(maxY / cellSizeMeters))

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = column * cellSizeMeters + cellSizeMeters / 2
        const y = row * cellSizeMeters + cellSizeMeters / 2

        if (pointInPolygon(x, y, parkArea)) {
          overlayInclusionMaskByCell[row * cols + column] = 1
          overlayExclusionMaskByCell[row * cols + column] = 1
        }
      }
    }
  }

  const averageCrimeDensity =
    crimeDensity.reduce((total, density) => total + density, 0) / Math.max(1, cellCount)
  const averageRegistryDensity =
    registryDensity.reduce((total, density) => total + density, 0) / Math.max(1, cellCount)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const index = row * cols + column
      const x = column * cellSizeMeters + cellSizeMeters / 2
      const y = row * cellSizeMeters + cellSizeMeters / 2
      const baseline = Math.max(averageCrimeDensity * 1.8, 0.28)
      const nightlifeScore = scoreByDistance(
        nearestMeters(x, y, projectedPois.noise) / 1000,
        criteriaById.noise,
      )

      factorScores.crime[index] =
        crimeIncidents.length > 0 ? clamp(1 - crimeDensity[index] / (baseline * 3.1)) : 0.5
      factorScores.registry[index] =
        registryRiskPoints.length > 0
          ? clamp(1 - registryDensity[index] / (Math.max(averageRegistryDensity * 1.6, 0.18) * 2.6))
          : 0.5
      factorScores.center[index] = scoreByDistance(
        Math.hypot(x - center.x, y - center.y) / 1000,
        criteriaById.center,
      )
      factorScores.noise[index] = Math.min(nightlifeScore, transportNoiseByCell[index])
      factorScores.parks[index] = parkInfluenceScore(
        x,
        y,
        projectedPois.parks,
        criteriaById.parks,
      )
      factorScores.groceries[index] = grocerySupplyScore(
        x,
        y,
        projectedPois.groceries,
        criteriaById.groceries,
      )
      factorScores.transit[index] = scoreByDistance(
        nearestMeters(x, y, projectedPois.transit) / 1000,
        criteriaById.transit,
      )
    }
  }

  return {
    cellSizeMeters,
    cols,
    rows,
    west: bounds.west,
    north: bounds.north,
    east: bounds.east,
    south: bounds.south,
    metersPerDegreeLng,
    factorScores,
    landScoreCapByCell,
    waterMaskByCell,
    roadMaskByCell,
    noGoMaskByCell,
    overlayInclusionMaskByCell,
    overlayExclusionMaskByCell,
    cityBoundaryMaskByCell,
    landProxySeedMaskByCell,
    residentialCandidateMaskByCell,
    overlayExclusionAreas,
    overlayExclusionLines,
    noGoOverlayAreas,
    averageCrimeDensity,
    averageRegistryDensity,
    noiseSegmentCount: noiseSegments.length,
    trafficSegmentCount: trafficSegments.length,
    landPenaltyAreaCount: landPenaltyAreas.length,
  }
}

const mixSuitabilityField = (
  criteria: Criterion[],
  spatialField: SpatialFactorField,
  residentialEvidence: ResidentialEvidenceField,
): SuitabilityField => {
  const cellCount = spatialField.cols * spatialField.rows
  const rawScores = new Float32Array(cellCount)
  const scores = new Float32Array(cellCount)
  const overlayInclusionMaskByCell = residentialEvidence.overlayInclusionMaskByCell
  const residentialCandidateMaskByCell = residentialEvidence.residentialCandidateMaskByCell
  const enabledCriteria = criteria.filter((criterion) => criterion.enabled && criterion.weight > 0)
  const totalWeight = enabledCriteria.reduce((total, criterion) => total + criterion.weight, 0)
  let minHabitableScore = Number.POSITIVE_INFINITY
  let maxHabitableScore = Number.NEGATIVE_INFINITY
  let scoreTotal = 0
  let habitableCellCount = 0
  const isEligibleCell = (index: number) =>
    spatialField.landScoreCapByCell[index] > 0 &&
    (Boolean(overlayInclusionMaskByCell[index]) ||
      (residentialEvidence.hasResidentialEvidence && Boolean(residentialCandidateMaskByCell[index]))) &&
    !spatialField.overlayExclusionMaskByCell[index] &&
    !spatialField.noGoMaskByCell[index]

  for (let index = 0; index < cellCount; index += 1) {
    let score = 0.5

    if (totalWeight > 0) {
      let weightedScore = 0

      for (const criterion of enabledCriteria) {
        weightedScore += spatialField.factorScores[criterion.id][index] * criterion.weight
      }

      score = weightedScore / totalWeight
    }

    const cappedScore = Math.min(score, spatialField.landScoreCapByCell[index])

    rawScores[index] = cappedScore

    if (isEligibleCell(index)) {
      if (cappedScore < minHabitableScore) {
        minHabitableScore = cappedScore
      }

      if (cappedScore > maxHabitableScore) {
        maxHabitableScore = cappedScore
      }

      habitableCellCount += 1
    }
  }

  const scoreRange = maxHabitableScore - minHabitableScore

  for (let index = 0; index < cellCount; index += 1) {
    const isHabitable = isEligibleCell(index)
    const normalizedScore =
      isHabitable && Number.isFinite(scoreRange) && scoreRange > 0.001
        ? clamp((rawScores[index] - minHabitableScore) / scoreRange)
        : rawScores[index]

    scores[index] = isHabitable
      ? normalizedScore
      : residentialEvidence.hasResidentialEvidence
        ? Math.min(rawScores[index], 0.42)
        : rawScores[index]

    if (isHabitable) {
      scoreTotal += scores[index]
    }
  }

  return {
    cellSizeMeters: spatialField.cellSizeMeters,
    cols: spatialField.cols,
    rows: spatialField.rows,
    west: spatialField.west,
    north: spatialField.north,
    east: spatialField.east,
    south: spatialField.south,
    metersPerDegreeLng: spatialField.metersPerDegreeLng,
    scores,
    waterMaskByCell: spatialField.waterMaskByCell,
    roadMaskByCell: spatialField.roadMaskByCell,
    noGoMaskByCell: spatialField.noGoMaskByCell,
    overlayInclusionMaskByCell,
    overlayExclusionMaskByCell: spatialField.overlayExclusionMaskByCell,
    cityBoundaryMaskByCell: spatialField.cityBoundaryMaskByCell,
    landProxySeedMaskByCell: spatialField.landProxySeedMaskByCell,
    residentialCandidateMaskByCell,
    overlayExclusionAreas: spatialField.overlayExclusionAreas,
    overlayExclusionLines: spatialField.overlayExclusionLines,
    noGoOverlayAreas: spatialField.noGoOverlayAreas,
    averageScore: scoreTotal / Math.max(1, habitableCellCount),
    evaluatedCellCount: habitableCellCount,
    averageCrimeDensity: spatialField.averageCrimeDensity,
    averageRegistryDensity: spatialField.averageRegistryDensity,
    noiseSegmentCount: spatialField.noiseSegmentCount,
    trafficSegmentCount: spatialField.trafficSegmentCount,
    landPenaltyAreaCount: spatialField.landPenaltyAreaCount,
  }
}

const buildResidentialEvidenceField = (
  spatialField: SpatialFactorField,
  buildingFootprints: BuildingFootprint[],
  buildingEligibilityActive: boolean,
): ResidentialEvidenceField => {
  const cellCount = spatialField.cols * spatialField.rows
  const overlayInclusionMaskByCell = new Uint8Array(spatialField.overlayInclusionMaskByCell)
  const residentialCandidateMaskByCell = new Uint8Array(spatialField.residentialCandidateMaskByCell)
  const bounds = fieldBounds(spatialField)
  let residentialCandidateCellCount = 0

  for (const building of buildingFootprints) {
    if (building.use === 'nonResidential') {
      continue
    }

    const point = latLngToMeters(building, bounds, spatialField.metersPerDegreeLng)
    const radiusCells = Math.max(
      1,
      Math.ceil(RESIDENTIAL_BUILDING_EVIDENCE_METERS / spatialField.cellSizeMeters),
    )
    const centerColumn = Math.floor(point.x / spatialField.cellSizeMeters)
    const centerRow = Math.floor(point.y / spatialField.cellSizeMeters)
    const minColumn = Math.max(0, centerColumn - radiusCells)
    const maxColumn = Math.min(spatialField.cols - 1, centerColumn + radiusCells)
    const minRow = Math.max(0, centerRow - radiusCells)
    const maxRow = Math.min(spatialField.rows - 1, centerRow + radiusCells)

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = column * spatialField.cellSizeMeters + spatialField.cellSizeMeters / 2
        const y = row * spatialField.cellSizeMeters + spatialField.cellSizeMeters / 2

        if (Math.hypot(x - point.x, y - point.y) <= RESIDENTIAL_BUILDING_EVIDENCE_METERS) {
          const index = row * spatialField.cols + column

          if (!spatialField.cityBoundaryMaskByCell[index]) {
            continue
          }

          residentialCandidateMaskByCell[index] = 1
          overlayInclusionMaskByCell[index] = 1
        }
      }
    }
  }

  let includedCellCount = 0

  for (let index = 0; index < cellCount; index += 1) {
    if (residentialCandidateMaskByCell[index]) {
      residentialCandidateCellCount += 1
    }

    if (overlayInclusionMaskByCell[index]) {
      includedCellCount += 1
    }
  }

  const isProvisionalEligibility = includedCellCount < Math.floor(cellCount * 0.72)

  if (isProvisionalEligibility) {
    const radiusCells = Math.max(1, Math.ceil(220 / spatialField.cellSizeMeters))

    for (let index = 0; index < cellCount; index += 1) {
      if (!spatialField.landProxySeedMaskByCell[index]) {
        continue
      }

      const seedRow = Math.floor(index / spatialField.cols)
      const seedColumn = index % spatialField.cols
      const minRow = Math.max(0, seedRow - radiusCells)
      const maxRow = Math.min(spatialField.rows - 1, seedRow + radiusCells)
      const minColumn = Math.max(0, seedColumn - radiusCells)
      const maxColumn = Math.min(spatialField.cols - 1, seedColumn + radiusCells)

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const targetIndex = row * spatialField.cols + column

          if (Math.hypot(row - seedRow, column - seedColumn) > radiusCells) {
            continue
          }

          if (
            spatialField.landScoreCapByCell[targetIndex] > 0 &&
            !spatialField.overlayExclusionMaskByCell[targetIndex] &&
            !spatialField.noGoMaskByCell[targetIndex]
          ) {
            overlayInclusionMaskByCell[targetIndex] = 1
          }
        }
      }
    }

    for (let index = 0; index < cellCount; index += 1) {
      if (
        overlayInclusionMaskByCell[index] ||
        !buildingEligibilityActive ||
        !residentialCandidateMaskByCell[index]
      ) {
        continue
      }

      if (
        spatialField.landScoreCapByCell[index] > 0 &&
        !spatialField.overlayExclusionMaskByCell[index] &&
        !spatialField.noGoMaskByCell[index]
      ) {
        overlayInclusionMaskByCell[index] = 1
      }
    }
  }

  const residentialEvidenceThreshold = Math.max(24, Math.floor(cellCount * 0.008))

  return {
    overlayInclusionMaskByCell,
    residentialCandidateMaskByCell,
    hasResidentialEvidence:
      buildingEligibilityActive && residentialCandidateCellCount >= residentialEvidenceThreshold,
    isProvisionalEligibility,
  }
}

const vectorExclusionAtPoint = (
  field: SuitabilityField,
  point: LatLng,
): 'area' | 'road' | 'water' | null => {
  const bounds = fieldBounds(field)
  const meters = latLngToMeters(point, bounds, field.metersPerDegreeLng)

  for (const area of field.overlayExclusionAreas) {
    if (area.points.length < 3) {
      continue
    }

    const projectedArea = area.points.map((areaPoint) =>
      latLngToMeters(areaPoint, bounds, field.metersPerDegreeLng),
    )
    const projectedHoles =
      area.holes?.map((hole) =>
        hole.map((holePoint) => latLngToMeters(holePoint, bounds, field.metersPerDegreeLng)),
      ) ?? []

    if (
      pointInPolygon(meters.x, meters.y, projectedArea) &&
      !projectedHoles.some((hole) => pointInPolygon(meters.x, meters.y, hole))
    ) {
      return 'area'
    }
  }

  for (const line of field.overlayExclusionLines) {
    const points = line.points.map((linePoint) =>
      latLngToMeters(linePoint, bounds, field.metersPerDegreeLng),
    )

    for (let index = 1; index < points.length; index += 1) {
      if (
        pointToSegmentDistanceMeters(meters.x, meters.y, points[index - 1], points[index]) <=
        line.bufferMeters
      ) {
        return line.kind
      }
    }
  }

  return null
}

const scoreAt = (field: SuitabilityField, point: LatLng) => {
  const meters = latLngToMeters(point, fieldBounds(field), field.metersPerDegreeLng)
  const column = clamp(Math.floor(meters.x / field.cellSizeMeters), 0, field.cols - 1)
  const row = clamp(Math.floor(meters.y / field.cellSizeMeters), 0, field.rows - 1)
  const index = row * field.cols + column

  return !vectorExclusionAtPoint(field, point) && isScorablePointCell(field, index)
    ? field.scores[index]
    : 0
}

const cellIndexAtPoint = (field: SuitabilityField, point: LatLng) => {
  const meters = latLngToMeters(point, fieldBounds(field), field.metersPerDegreeLng)
  const column = clamp(Math.floor(meters.x / field.cellSizeMeters), 0, field.cols - 1)
  const row = clamp(Math.floor(meters.y / field.cellSizeMeters), 0, field.rows - 1)

  return row * field.cols + column
}

const colorChannelsForScore = (score: number) => {
  const normalizedScore = clamp(score) * 100

  for (let index = 1; index < SCORE_BANDS.length; index += 1) {
    const previous = SCORE_BANDS[index - 1]
    const next = SCORE_BANDS[index]

    if (normalizedScore <= next.min) {
      const progress = clamp((normalizedScore - previous.min) / (next.min - previous.min))

      return previous.rgb.map((channel, channelIndex) =>
        Math.round(channel + (next.rgb[channelIndex] - channel) * progress),
      ) as [number, number, number]
    }
  }

  return [...SCORE_BANDS[SCORE_BANDS.length - 1].rgb] as [number, number, number]
}

const colorForScore = (score: number) => {
  const [red, green, blue] = colorChannelsForScore(score)
  return `rgb(${red} ${green} ${blue})`
}

const isDrawableOverlayCell = (field: SuitabilityField, index: number) =>
  Boolean(field.overlayInclusionMaskByCell[index]) &&
  !field.overlayExclusionMaskByCell[index] &&
  !field.noGoMaskByCell[index]

const isScorablePointCell = (field: SuitabilityField, index: number) =>
  isDrawableOverlayCell(field, index)

const isSmoothingSourceCell = (field: SuitabilityField, index: number) =>
  isScorablePointCell(field, index)

const smoothedCellScore = (field: SuitabilityField, row: number, column: number) => {
  const sourceIndex = row * field.cols + column

  if (!isDrawableOverlayCell(field, sourceIndex)) {
    return field.scores[sourceIndex]
  }

  let weightedScore = 0
  let totalWeight = 0

  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const sourceRow = row + dy
      const sourceColumn = column + dx

      if (
        sourceRow < 0 ||
        sourceRow >= field.rows ||
        sourceColumn < 0 ||
        sourceColumn >= field.cols
      ) {
        continue
      }

      const index = sourceRow * field.cols + sourceColumn

      if (!isSmoothingSourceCell(field, index)) {
        continue
      }

      const weight = Math.exp(-(dx * dx + dy * dy) / 3.2)

      weightedScore += field.scores[index] * weight
      totalWeight += weight
    }
  }

  return totalWeight > 0 ? weightedScore / totalWeight : field.scores[sourceIndex]
}

const labelForScore = (score: number) => {
  const normalizedScore = Math.round(clamp(score) * 100)
  const band = SCORE_BANDS.find(
    (scoreBand) => normalizedScore >= scoreBand.min && normalizedScore <= scoreBand.max,
  )

  return band?.label ?? SCORE_BANDS[SCORE_BANDS.length - 1].label
}

const formatMeters = (meters: number) => {
  if (!Number.isFinite(meters)) {
    return 'no data'
  }

  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

const loadStatusText = (stage: LoadStage) => {
  if (stage.status === 'loading') {
    return 'loading'
  }

  if (stage.status === 'cached') {
    return stage.count === undefined ? 'cached' : `cached ${stage.count}`
  }

  if (stage.status === 'live') {
    return stage.count === undefined ? 'ready' : String(stage.count)
  }

  if (stage.status === 'partial') {
    return stage.detail ?? `${stage.count ?? 0}`
  }

  if (stage.status === 'empty') {
    if (stage.detail === 'unsupported') {
      return 'n/a'
    }

    if (stage.detail === 'Boston only') {
      return 'Boston only'
    }

    return 'none'
  }

  if (stage.status === 'error') {
    return 'error'
  }

  return 'pending'
}

const nearestPoiDetail = (
  x: number,
  y: number,
  pois: Poi[],
  bounds = BOSTON_BOUNDS,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
) => {
  let nearestDistance = Number.POSITIVE_INFINITY
  let nearestPoi: Poi | null = null

  for (const poi of pois) {
    const point = latLngToMeters(poi, bounds, metersPerDegreeLng)
    const distance = Math.hypot(x - point.x, y - point.y)

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestPoi = poi
    }
  }

  return {
    distance: nearestDistance,
    poi: nearestPoi,
  }
}

const nearestSegmentDistance = (
  x: number,
  y: number,
  segments: Array<NoiseSegment | TrafficSegment>,
  bounds = BOSTON_BOUNDS,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
) => {
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const segment of segments) {
    const points = segment.points.map((point) => latLngToMeters(point, bounds, metersPerDegreeLng))

    for (let index = 1; index < points.length; index += 1) {
      const distance = pointToSegmentDistanceMeters(x, y, points[index - 1], points[index])

      if (distance < nearestDistance) {
        nearestDistance = distance
      }
    }
  }

  return nearestDistance
}

const landCapAtPoint = (
  x: number,
  y: number,
  areas: LandPenaltyArea[],
  bounds = BOSTON_BOUNDS,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
) => {
  let cap = 1
  let waterCapApplied = false

  for (const area of areas) {
    const points = area.points.map((point) => latLngToMeters(point, bounds, metersPerDegreeLng))
    const holes = area.holes?.map((hole) =>
      hole.map((point) => latLngToMeters(point, bounds, metersPerDegreeLng)),
    ) ?? []

    if (!pointInPolygon(x, y, points) || holes.some((hole) => pointInPolygon(x, y, hole))) {
      continue
    }

    if (area.kind === 'land' && waterCapApplied) {
      cap = Math.max(cap, area.maxScore)
      waterCapApplied = false
      continue
    }

    if (waterCapApplied && area.kind !== 'water') {
      cap = area.maxScore
      waterCapApplied = false
      continue
    }

    if (area.maxScore < cap) {
      cap = area.maxScore
      waterCapApplied = area.kind === 'water'
    }
  }

  return cap
}

const nearestBuildingDetail = (
  point: LatLng,
  buildings: BuildingFootprint[],
  field: SuitabilityField,
) => {
  const bounds = fieldBounds(field)
  const target = latLngToMeters(point, bounds, field.metersPerDegreeLng)
  let nearestDistance = Number.POSITIVE_INFINITY
  let nearestBuilding: BuildingFootprint | null = null

  for (const building of buildings) {
    const buildingPoint = latLngToMeters(building, bounds, field.metersPerDegreeLng)
    const distance = Math.hypot(target.x - buildingPoint.x, target.y - buildingPoint.y)

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestBuilding = building
    }
  }

  return {
    distance: nearestDistance,
    building: nearestDistance <= BUILDING_MATCH_RADIUS_METERS ? nearestBuilding : null,
  }
}

const crimeScoreAtPoint = (
  point: LatLng,
  incidents: CrimeIncident[],
  averageCrimeDensity: number,
  bounds = BOSTON_BOUNDS,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
) => {
  if (incidents.length === 0) {
    return 0.5
  }

  const center = latLngToMeters(point, bounds, metersPerDegreeLng)
  let localWeightedDensity = 0

  for (const incident of incidents) {
    const incidentPoint = latLngToMeters(incident, bounds, metersPerDegreeLng)
    const distance = Math.hypot(center.x - incidentPoint.x, center.y - incidentPoint.y)

    if (distance <= CRIME_RADIUS_METERS) {
      const normalizedDistance = distance / CRIME_RADIUS_METERS
      localWeightedDensity += Math.exp(-(normalizedDistance * normalizedDistance) / 0.42)
    }
  }

  const baseline = Math.max(averageCrimeDensity * 1.8, 0.28)

  return clamp(1 - localWeightedDensity / (baseline * 3.1))
}

const analyzePoint = (
  point: LatLng,
  city: CityConfig,
  criteria: Criterion[],
  field: SuitabilityField,
  poisByCategory: Record<PoiCategory, Poi[]>,
  crimeIncidents: CrimeIncident[],
  registryRiskPoints: RegistryRiskPoint[],
  noiseSegments: NoiseSegment[],
  landPenaltyAreas: LandPenaltyArea[],
  trafficSegments: TrafficSegment[],
  dataCoverage: number,
): PointAnalysis => {
  const bounds = fieldBounds(field)
  const meters = latLngToMeters(point, bounds, field.metersPerDegreeLng)
  const cellIndex = cellIndexAtPoint(field, point)
  const score = scoreAt(field, point)
  const criteriaById = Object.fromEntries(criteria.map((criterion) => [criterion.id, criterion])) as Record<
    CriterionId,
    Criterion
  >
  const nearestPark = nearestPoiDetail(meters.x, meters.y, poisByCategory.parks, bounds, field.metersPerDegreeLng)
  const nearestGrocery = nearestPoiDetail(meters.x, meters.y, poisByCategory.groceries, bounds, field.metersPerDegreeLng)
  const nearestNightlife = nearestPoiDetail(meters.x, meters.y, poisByCategory.noise, bounds, field.metersPerDegreeLng)
  const nearestTransit = nearestPoiDetail(meters.x, meters.y, poisByCategory.transit, bounds, field.metersPerDegreeLng)
  const nearestTransport = Math.min(
    nearestSegmentDistance(meters.x, meters.y, noiseSegments, bounds, field.metersPerDegreeLng),
    nearestSegmentDistance(meters.x, meters.y, trafficSegments, bounds, field.metersPerDegreeLng),
  )
  const parkScore = parkInfluenceScore(
    meters.x,
    meters.y,
    poisByCategory.parks.map((poi) => projectPoi(poi, bounds, field.metersPerDegreeLng)),
    criteriaById.parks,
  )
  const grocerySupply = grocerySupplyDetail(
    meters.x,
    meters.y,
    poisByCategory.groceries.map((poi) => projectPoi(poi, bounds, field.metersPerDegreeLng)),
    criteriaById.groceries,
  )
  const groceryScore = grocerySupply.score
  const nightlifeScore = scoreByDistance(nearestNightlife.distance / 1000, criteriaById.noise)
  const transportScore = Number.isFinite(nearestTransport)
    ? clamp(0.38 + Math.pow(clamp(nearestTransport / 520), 0.7) * 0.62)
    : 1
  const noiseScore = Math.min(nightlifeScore, transportScore)
  const transitScore = scoreByDistance(nearestTransit.distance / 1000, criteriaById.transit)
  const scoringCenter = latLngToMeters(scoreCenterForCity(city), bounds, field.metersPerDegreeLng)
  const centerScore = scoreByDistance(
    Math.hypot(meters.x - scoringCenter.x, meters.y - scoringCenter.y) / 1000,
    criteriaById.center,
  )
  const crimeScore = crimeScoreAtPoint(point, crimeIncidents, field.averageCrimeDensity, bounds, field.metersPerDegreeLng)
  const registryScore = registryRiskScoreAtPoint(
    point,
    registryRiskPoints,
    field.averageRegistryDensity,
    bounds,
    field.metersPerDegreeLng,
  )
  const landCap = landCapAtPoint(meters.x, meters.y, landPenaltyAreas, bounds, field.metersPerDegreeLng)
  const hasOverlayInclusion = Boolean(field.overlayInclusionMaskByCell[cellIndex])
  const hasOverlayExclusion = Boolean(field.overlayExclusionMaskByCell[cellIndex])
  const hasResidentialEvidence = Boolean(field.residentialCandidateMaskByCell[cellIndex])
  const vectorExclusion = vectorExclusionAtPoint(field, point)
  const isNoGo = Boolean(field.noGoMaskByCell[cellIndex])
  const isWater = Boolean(field.waterMaskByCell[cellIndex]) || vectorExclusion === 'water'
  const isRoad = vectorExclusion === 'road'
  const isAreaExcluded = vectorExclusion === 'area'
  const isUnscorableLand =
    !hasOverlayInclusion || isWater || isRoad || isNoGo || hasOverlayExclusion || isAreaExcluded
  const landFactorScore = isUnscorableLand
    ? 0
    : hasResidentialEvidence
      ? landCap < 1
        ? landCap
        : 0.86
      : Math.min(landCap, 0.42)
  const pointLandStatus = isWater
    ? 'water'
    : isRoad
      ? 'road'
      : isNoGo
        ? 'non-residential/no-go'
        : hasOverlayExclusion || isAreaExcluded
          ? 'excluded'
          : hasResidentialEvidence
            ? 'residential signal'
            : hasOverlayInclusion
              ? 'land without residential signal'
              : 'no land mask'
  const landDetail = isRoad
    ? 'road / non-residential'
    : landCap === 0
      ? 'water / non-residential'
      : landCap < 1
        ? 'OSM cap: non-residential zone'
        : 'OSM cap not found'
  const factors: FactorBreakdown[] = [
    {
      id: 'parks',
      label: 'Parks',
      score: parkScore,
      detail: `${nearestPark.poi?.name ?? 'Park'} · ${formatMeters(nearestPark.distance)}`,
    },
    {
      id: 'groceries',
      label: 'Groceries',
      score: groceryScore,
      detail: `${nearestGrocery.poi?.name ?? 'Store'} · ${formatMeters(nearestGrocery.distance)}, ${grocerySupply.nearbyCount} nearby`,
      summary:
        grocerySupply.nearbyCount >= 5
          ? `${grocerySupply.nearbyCount} stores nearby`
          : `${grocerySupply.nearbyCount} nearby · ${formatMeters(nearestGrocery.distance)}`,
    },
    {
      id: 'noise',
      label: 'Noise',
      score: noiseScore,
      detail: `traffic ${formatMeters(nearestTransport)}, nightlife ${formatMeters(nearestNightlife.distance)}`,
      summary: `traffic ${formatMeters(nearestTransport)}`,
    },
    {
      id: 'transit',
      label: 'Transit',
      score: transitScore,
      detail: `${nearestTransit.poi?.name ?? 'Station'} · ${formatMeters(nearestTransit.distance)}`,
      summary: formatMeters(nearestTransit.distance),
    },
    {
      id: 'center',
      label: 'Center',
      score: centerScore,
      detail: `${formatMeters(Math.hypot(meters.x - scoringCenter.x, meters.y - scoringCenter.y))}`,
    },
    {
      id: 'crime',
      label: 'Crime',
      score: crimeScore,
      detail:
        crimeIncidents.length === 0
          ? 'no live data'
          : crimeScore >= 0.65
            ? 'below baseline'
            : crimeScore >= 0.4
              ? 'near baseline'
              : 'above baseline',
    },
    {
      id: 'registry',
      label: 'Registry',
      score: registryScore,
      detail:
        registryRiskPoints.length === 0
          ? 'no data'
          : registryScore >= 0.65
            ? 'low baseline'
            : registryScore >= 0.4
              ? 'moderate baseline'
              : 'elevated baseline',
    },
    {
      id: 'land',
      label: 'Land',
      score: landFactorScore,
      detail: landDetail,
      summary: pointLandStatus,
    },
  ]
  const sortedFactors = [...factors].sort((a, b) => a.score - b.score)
  const worstFactor = sortedFactors[0]
  const bestFactor = sortedFactors[sortedFactors.length - 1]
  const riskScore = 1 - Math.min(noiseScore, crimeScore, registryScore, landFactorScore)
  const opportunityScore = clamp(score * 0.72 + transitScore * 0.14 + groceryScore * 0.14 - riskScore * 0.18)
  const confidence = clamp(
    dataCoverage * 0.72 +
      (landCap < 1 ? 0.08 : 0.16) +
      (crimeIncidents.length > 0 ? 0.08 : 0) +
      (registryRiskPoints.length > 0 ? 0.04 : 0),
  )
  const landConfidence = isUnscorableLand ? 0 : hasResidentialEvidence ? 1 : 0.55
  const adjustedConfidence = Math.min(confidence, clamp(0.42 + landConfidence * 0.58))
  const dataCompleteness: PointDataItem[] = [
    {
      label: 'Land',
      value: pointLandStatus,
      tone: isWater || isRoad || isNoGo || hasOverlayExclusion ? 'bad' : hasResidentialEvidence ? 'good' : 'warn',
    },
    {
      label: 'Residential signal',
      value: hasResidentialEvidence ? 'present' : 'not found',
      tone: hasResidentialEvidence ? 'good' : 'warn',
    },
    {
      label: 'Crime',
      value: crimeIncidents.length > 0 ? `radius ${CRIME_RADIUS_METERS} m` : 'no live data',
      tone: crimeIncidents.length > 0 ? 'good' : 'bad',
    },
    {
      label: 'Registry',
      value: registryRiskPoints.length > 0 ? `radius ${REGISTRY_RISK_RADIUS_METERS} m` : 'no data',
      tone: registryRiskPoints.length > 0 ? 'warn' : 'neutral',
    },
    {
      label: 'Noise',
      value:
        noiseSegments.length > 0 || poisByCategory.noise.length > 0
          ? `traffic ${formatMeters(nearestTransport)}`
          : 'no sources',
      tone: noiseSegments.length > 0 || poisByCategory.noise.length > 0 ? 'good' : 'warn',
    },
    {
      label: 'Amenities',
      value: `${poisByCategory.parks.length}/${poisByCategory.groceries.length}/${poisByCategory.transit.length}`,
      tone:
        poisByCategory.parks.length > 0 &&
        poisByCategory.groceries.length > 0 &&
        poisByCategory.transit.length > 0
          ? 'good'
          : 'warn',
    },
  ]
  const thesis =
    score >= 0.62 && riskScore < 0.45
      ? 'Shortlist candidate: strong suitability without critical risk.'
      : riskScore >= 0.65
        ? 'Needs caution: risk or noise dominates amenities.'
        : 'Borderline area: check the exact property and street context.'

  return {
    point,
    score,
    label: labelForScore(score),
    factors,
    dataCompleteness,
    bestFactor,
    worstFactor,
    riskScore,
    opportunityScore,
    confidence: adjustedConfidence,
    thesis,
  }
}

const SuitabilityCanvasOverlay = ({
  field,
  resolving,
  mode,
  opacity,
  visible,
}: {
  field: SuitabilityField
  resolving: boolean
  mode: LayerMode
  opacity: number
  visible: boolean
}) => {
  const map = useMap()

  useEffect(() => {
    type ZoomAnimationMap = typeof map & {
      _latLngBoundsToNewLayerBounds: (
        bounds: LeafletLatLngBounds,
        zoom: number,
        center: ZoomAnimEvent['center'],
      ) => LeafletBounds
    }

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const pane = map.getPanes().overlayPane

    if (!context) {
      return undefined
    }

    canvas.className = 'suitability-canvas leaflet-zoom-animated'
    canvas.style.transformOrigin = '0 0'
    pane.append(canvas)

    const offscreen = document.createElement('canvas')
    const offscreenContext = offscreen.getContext('2d')

    if (!offscreenContext) {
      canvas.remove()
      return undefined
    }

    offscreen.width = field.cols
    offscreen.height = field.rows

    const image = offscreenContext.createImageData(field.cols, field.rows)

    for (let row = 0; row < field.rows; row += 1) {
      for (let column = 0; column < field.cols; column += 1) {
        const fieldIndex = row * field.cols + column
        const baseScore = smoothedCellScore(field, row, column)
        const index = fieldIndex * 4

        if (!isDrawableOverlayCell(field, fieldIndex)) {
          image.data[index + 3] = 0
          continue
        }

        const score =
          mode === 'risk'
            ? 1 - baseScore
            : mode === 'opportunity'
              ? clamp((baseScore - field.averageScore + 0.5) * 1.08)
              : baseScore
        const [red, green, blue] = colorChannelsForScore(score)

        if (baseScore <= 0.005) {
          image.data[index] = 215
          image.data[index + 1] = 25
          image.data[index + 2] = 28
          image.data[index + 3] = visible ? Math.round(opacity * 210) : 0
          continue
        }

        image.data[index] = red
        image.data[index + 1] = green
        image.data[index + 2] = blue
        image.data[index + 3] = visible ? Math.round(opacity * 255) : 0
      }
    }

    offscreenContext.putImageData(image, 0, 0)

    let frameId = 0
    let pulseFrameId = 0
    let canvasWidth = 0
    let canvasHeight = 0
    let isInteracting = false
    let isZooming = false
    let canvasBounds = map.getBounds()

    const AREA_DETAIL_MIN_ZOOM = 12
    const ROAD_DETAIL_MIN_ZOOM = 13
    const vectorDetailCount = field.overlayExclusionAreas.length + field.overlayExclusionLines.length
    const canDrawVectorDetail = vectorDetailCount <= 2_500

    const draw = () => {
      if (isZooming) {
        return
      }

      const size = map.getSize()
      const deviceScale = window.devicePixelRatio || 1
      const zoom = map.getZoom()
      const shouldDrawAreaDetail =
        canDrawVectorDetail && !isInteracting && zoom >= AREA_DETAIL_MIN_ZOOM
      const shouldDrawRoadDetail =
        canDrawVectorDetail && !isInteracting && zoom >= ROAD_DETAIL_MIN_ZOOM
      const topLeft = map.containerPointToLayerPoint([0, 0])
      const northWest = map.latLngToLayerPoint([field.north, field.west])
      const southEast = map.latLngToLayerPoint([field.south, field.east])
      const drawX = northWest.x - topLeft.x
      const drawY = northWest.y - topLeft.y
      const drawWidth = southEast.x - northWest.x
      const drawHeight = southEast.y - northWest.y

      const nextCanvasWidth = Math.round(size.x * deviceScale)
      const nextCanvasHeight = Math.round(size.y * deviceScale)

      if (canvasWidth !== nextCanvasWidth || canvasHeight !== nextCanvasHeight) {
        canvasWidth = nextCanvasWidth
        canvasHeight = nextCanvasHeight
        canvas.width = canvasWidth
        canvas.height = canvasHeight
        canvas.style.width = `${size.x}px`
        canvas.style.height = `${size.y}px`
      }

      canvasBounds = map.getBounds()
      canvas.style.transform = `translate3d(${topLeft.x}px, ${topLeft.y}px, 0)`
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0)
      context.clearRect(0, 0, size.x, size.y)

      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = isInteracting ? 'low' : 'high'
      context.globalCompositeOperation = 'source-over'
      context.drawImage(offscreen, drawX, drawY, drawWidth, drawHeight)

      context.globalCompositeOperation = 'soft-light'
      context.fillStyle = 'rgba(255, 255, 255, 0.12)'
      context.fillRect(0, 0, size.x, size.y)
      context.globalCompositeOperation = 'source-over'

      if (shouldDrawAreaDetail) {
        eraseOverlayExclusions()
        eraseOverlayExclusionLines('water')
        drawNoGoOverlays()
      }

      if (shouldDrawRoadDetail) {
        eraseOverlayExclusionLines('road')
      }
    }

    const scheduleDraw = () => {
      if (frameId) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        draw()
      })
    }

    const handleMoveStart = () => {
      if (isInteracting) {
        return
      }

      isInteracting = true
      scheduleDraw()
    }

    const handleZoomStart = () => {
      isInteracting = true
      isZooming = true
    }

    const handleZoomAnimation = (event: ZoomAnimEvent) => {
      const animatedMap = map as ZoomAnimationMap
      const scale = map.getZoomScale(event.zoom)
      const nextBounds = animatedMap._latLngBoundsToNewLayerBounds(
        canvasBounds,
        event.zoom,
        event.center,
      )
      const offset = nextBounds.min

      if (!offset) {
        return
      }

      canvas.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`
    }

    const handleInteractionEnd = () => {
      isZooming = false
      isInteracting = false
      scheduleDraw()
    }

    const eraseOverlayExclusions = () => {
      if (field.overlayExclusionAreas.length === 0) {
        return
      }

      context.save()
      context.globalCompositeOperation = 'destination-out'
      context.fillStyle = 'rgba(0, 0, 0, 1)'

      for (const area of field.overlayExclusionAreas) {
        if (area.points.length < 3) {
          continue
        }

        context.beginPath()

        area.points.forEach((point, pointIndex) => {
          const layerPoint = map.latLngToContainerPoint([point.lat, point.lng])

          if (pointIndex === 0) {
            context.moveTo(layerPoint.x, layerPoint.y)
          } else {
            context.lineTo(layerPoint.x, layerPoint.y)
          }
        })

        context.closePath()

        area.holes?.forEach((hole) => {
          if (hole.length < 3) {
            return
          }

          hole.forEach((point, pointIndex) => {
            const layerPoint = map.latLngToContainerPoint([point.lat, point.lng])

            if (pointIndex === 0) {
              context.moveTo(layerPoint.x, layerPoint.y)
            } else {
              context.lineTo(layerPoint.x, layerPoint.y)
            }
          })

          context.closePath()
        })

        context.fill('evenodd')
      }

      context.restore()
    }

    const metersToCanvasPixels = (point: LatLng, meters: number) => {
      const current = map.latLngToContainerPoint([point.lat, point.lng])
      const shifted = map.latLngToContainerPoint([point.lat + meters / METERS_PER_DEGREE_LAT, point.lng])

      return Math.max(1, Math.abs(current.y - shifted.y))
    }

    const eraseOverlayExclusionLines = (kind: 'road' | 'water') => {
      if (field.overlayExclusionLines.length === 0) {
        return
      }

      context.save()
      context.globalCompositeOperation = 'destination-out'
      context.strokeStyle = 'rgba(0, 0, 0, 1)'
      context.lineCap = 'round'
      context.lineJoin = 'round'

      for (const line of field.overlayExclusionLines) {
        if (line.kind !== kind) {
          continue
        }

        if (line.points.length < 2) {
          continue
        }

        context.lineWidth = metersToCanvasPixels(line.points[0], line.bufferMeters * 2)
        context.beginPath()

        line.points.forEach((point, pointIndex) => {
          const layerPoint = map.latLngToContainerPoint([point.lat, point.lng])

          if (pointIndex === 0) {
            context.moveTo(layerPoint.x, layerPoint.y)
          } else {
            context.lineTo(layerPoint.x, layerPoint.y)
          }
        })

        context.stroke()
      }

      context.restore()
    }

    const drawNoGoOverlays = () => {
      if (!visible || field.noGoOverlayAreas.length === 0) {
        return
      }

      context.save()
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = `rgba(215, 25, 28, ${Math.min(0.68, opacity * 0.78)})`

      for (const area of field.noGoOverlayAreas) {
        if (area.length < 3) {
          continue
        }

        context.beginPath()

        area.forEach((point, pointIndex) => {
          const layerPoint = map.latLngToContainerPoint([point.lat, point.lng])

          if (pointIndex === 0) {
            context.moveTo(layerPoint.x, layerPoint.y)
          } else {
            context.lineTo(layerPoint.x, layerPoint.y)
          }
        })

        context.closePath()
        context.fill()
      }

      context.restore()
    }

    draw()
    map.on('movestart', handleMoveStart)
    map.on('zoomstart', handleZoomStart)
    map.on('zoomanim', handleZoomAnimation)
    map.on('move resize viewreset', scheduleDraw)
    map.on('moveend zoomend', handleInteractionEnd)

    const pulse = () => {
      const loadingOpacity = resolving ? 0.88 + Math.sin(performance.now() / 520) * 0.07 : 1

      canvas.style.opacity = visible ? String(loadingOpacity) : '0'
      pulseFrameId = window.requestAnimationFrame(pulse)
    }

    if (resolving) {
      pulse()
    } else {
      canvas.style.opacity = visible ? '1' : '0'
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }

      if (pulseFrameId) {
        window.cancelAnimationFrame(pulseFrameId)
      }

      map.off('movestart', handleMoveStart)
      map.off('zoomstart', handleZoomStart)
      map.off('zoomanim', handleZoomAnimation)
      map.off('move resize viewreset', scheduleDraw)
      map.off('moveend zoomend', handleInteractionEnd)
      canvas.remove()
    }
  }, [field, map, mode, opacity, resolving, visible])

  return null
}

const MapClickSelector = ({
  disabled,
  onSelect,
}: {
  disabled: boolean
  onSelect: (point: LatLng) => void
}) => {
  useMapEvents({
    click(event) {
      if (disabled) {
        return
      }

      onSelect({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      })
    },
  })

  return null
}

const MapRegionSelector = ({
  active,
  draftBounds,
  selectedBounds,
  onDraft,
  onSelect,
}: {
  active: boolean
  draftBounds: MapBounds | null
  selectedBounds: MapBounds | null
  onDraft: (bounds: MapBounds | null) => void
  onSelect: (bounds: MapBounds) => void
}) => {
  const map = useMap()
  const [startPoint, setStartPoint] = useState<LatLng | null>(null)

  useEffect(() => {
    if (active) {
      map.dragging.disable()
      map.getContainer().classList.add('region-selecting')
    } else {
      map.dragging.enable()
      map.getContainer().classList.remove('region-selecting')
    }

    return () => {
      map.dragging.enable()
      map.getContainer().classList.remove('region-selecting')
    }
  }, [active, map])

  useMapEvents({
    mousedown(event) {
      if (!active) {
        return
      }

      const point = { lat: event.latlng.lat, lng: event.latlng.lng }

      setStartPoint(point)
      onDraft(normalizeBounds(point, point))
    },
    mousemove(event) {
      if (!active || !startPoint) {
        return
      }

      onDraft(normalizeBounds(startPoint, { lat: event.latlng.lat, lng: event.latlng.lng }))
    },
    mouseup(event) {
      if (!active || !startPoint) {
        return
      }

      const bounds = normalizeBounds(startPoint, { lat: event.latlng.lat, lng: event.latlng.lng })
      const isMeaningful = bounds.north - bounds.south > 0.002 && bounds.east - bounds.west > 0.002

      setStartPoint(null)
      onDraft(null)

      if (isMeaningful) {
        onSelect(bounds)
      }
    },
  })

  const displayBounds = draftBounds ?? selectedBounds

  return displayBounds ? (
    <Rectangle
      bounds={[
        [displayBounds.south, displayBounds.west],
        [displayBounds.north, displayBounds.east],
      ]}
      pathOptions={{
        color: '#15181f',
        dashArray: '7 6',
        fillColor: '#15181f',
        fillOpacity: 0.06,
        opacity: 0.9,
        weight: 2,
      }}
    />
  ) : null
}

const MapViewportSync = ({ bounds }: { bounds: MapBounds }) => {
  const map = useMap()

  useEffect(() => {
    map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { animate: false, padding: [18, 18] },
    )
  }, [bounds, map])

  return null
}

const MapLayoutResizeSync = ({ layoutKey }: { layoutKey: string }) => {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const observedElements = [container, container.parentElement].filter(
      (element): element is HTMLElement => Boolean(element),
    )
    let frameId = 0
    const timeoutIds: number[] = []

    const invalidate = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        map.invalidateSize({ animate: false })
      })
    }

    invalidate()
    timeoutIds.push(window.setTimeout(invalidate, 80))
    timeoutIds.push(window.setTimeout(invalidate, 220))

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => invalidate())

    observedElements.forEach((element) => observer?.observe(element))
    window.addEventListener('resize', invalidate)

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }

      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
      observer?.disconnect()
      window.removeEventListener('resize', invalidate)
    }
  }, [layoutKey, map])

  return null
}

const PointCompletenessPanel = ({
  analysis,
  building,
  buildingDistance,
  buildingDataMode,
  city,
  compact = false,
}: {
  analysis: PointAnalysis
  building: BuildingFootprint | null
  buildingDistance: number
  buildingDataMode: BuildingDataMode
  city: CityConfig
  compact?: boolean
}) => {
  const buildingItem: PointDataItem = {
    label: 'Building',
    value:
      buildingDataMode === 'loading'
        ? 'loading'
        : building
          ? `${building.levels ?? '?'} fl. · ${formatMeters(buildingDistance)}`
          : buildingDataMode === 'partial'
            ? 'not found in partial data'
            : 'not found',
    tone:
      buildingDataMode === 'loading'
        ? 'neutral'
        : building
          ? 'good'
          : buildingDataMode === 'partial'
            ? 'warn'
            : 'bad',
  }
  const landItem = analysis.dataCompleteness[0]
  const crimeItem: PointDataItem =
    supportsBostonCrimeData(city)
      ? analysis.dataCompleteness[2]
      : { label: 'Crime', value: city.countryCode === 'us' ? 'Boston only' : 'n/a', tone: 'neutral' }
  const compactItems = [
    landItem,
    analysis.worstFactor.id === 'land' ? analysis.factors.find((factor) => factor.id === 'noise') : analysis.worstFactor,
    building ? buildingItem : null,
  ]
    .filter((item): item is PointDataItem | FactorBreakdown => Boolean(item))
    .slice(0, 3)
    .map((item): PointDataItem => ({
      label: item.label,
      value: 'detail' in item ? item.summary ?? item.detail : item.value,
      tone:
        'tone' in item
          ? item.tone
          : item.score >= 0.62
            ? 'good'
            : item.score >= 0.38
              ? 'warn'
              : 'bad',
    }))
  const items = compact
    ? compactItems
    : [landItem, crimeItem, ...analysis.dataCompleteness.slice(3), buildingItem]

  return (
    <div className={compact ? 'point-data-grid compact' : 'point-data-grid'}>
      {items.map((item) => (
        <div className={`point-data-row ${item.tone}`} key={`${item.label}-${item.value}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  )
}

const App = () => {
  const [selectedState, setSelectedState] = useState('MA')
  const [selectedCityId, setSelectedCityId] = useState('ma-boston')
  const [customCity, setCustomCity] = useState<CityConfig | null>(null)
  const [citySearchText, setCitySearchText] = useState('Boston')
  const [zipSearchText, setZipSearchText] = useState('')
  const [isSearchingCity, setIsSearchingCity] = useState(false)
  const [isSearchingZip, setIsSearchingZip] = useState(false)
  const [cellSizeMeters, setCellSizeMeters] = useState<number>(DEFAULT_CELL_SIZE_METERS)
  const [appliedCellSizeMeters, setAppliedCellSizeMeters] =
    useState<number>(DEFAULT_CELL_SIZE_METERS)
  const [criteria, setCriteria] = useState(INITIAL_CRITERIA)
  const [pois, setPois] = useState<Poi[]>(FALLBACK_POIS)
  const [crimeIncidents, setCrimeIncidents] = useState<CrimeIncident[]>([])
  const [registryRiskPoints, setRegistryRiskPoints] = useState<RegistryRiskPoint[]>([])
  const [noiseSegments, setNoiseSegments] = useState<NoiseSegment[]>([])
  const [landPenaltyAreas, setLandPenaltyAreas] = useState<LandPenaltyArea[]>([])
  const [trafficSegments, setTrafficSegments] = useState<TrafficSegment[]>([])
  const [buildingFootprints, setBuildingFootprints] = useState<BuildingFootprint[]>([])
  const [buildingDataMode, setBuildingDataMode] = useState<BuildingDataMode>('empty')
  const [buildingTotalCount, setBuildingTotalCount] = useState(0)
  const [buildingIsCapped, setBuildingIsCapped] = useState(false)
  const [desiredFloor, setDesiredFloor] = useState(8)
  const [isLoading, setIsLoading] = useState(true)
  const [dataMode, setDataMode] = useState<DataMode>('sample')
  const [crimeDataMode, setCrimeDataMode] = useState<CrimeDataMode>('empty')
  const [registryDataMode, setRegistryDataMode] = useState<RegistryDataMode>('empty')
  const [error, setError] = useState<string | null>(null)
  const [showPois, setShowPois] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)
  const [overlayOpacity, setOverlayOpacity] = useState(0.56)
  const [layerMode, setLayerMode] = useState<LayerMode>('suitability')
  const [selectedPoint, setSelectedPoint] = useState<LatLng>({
    lat: 42.3503,
    lng: -71.081,
  })
  const [savedSites, setSavedSites] = useState<SavedSite[]>([])
  const [activeProfileId, setActiveProfileId] = useState('balanced')
  const [refreshToken, setRefreshToken] = useState(0)
  const [forceRefreshZoneKey, setForceRefreshZoneKey] = useState<string | null>(null)
  const [loadStages, setLoadStages] = useState<Record<LoadStageId, LoadStage>>(INITIAL_LOAD_STAGES)
  const [isRegionSelectMode, setIsRegionSelectMode] = useState(false)
  const [draftRegionBounds, setDraftRegionBounds] = useState<MapBounds | null>(null)
  const [selectedRegionBounds, setSelectedRegionBounds] = useState<MapBounds | null>(null)
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true)
  const [isInspectorOpen, setIsInspectorOpen] = useState(true)
  const [appLanguage, setAppLanguage] = useState<'ru' | 'en'>('en')
  const deferredCriteria = useDeferredValue(criteria)
  const isEnglish = appLanguage === 'en'
  const shellTitle = isEnglish ? 'Housing suitability map' : 'Housing suitability map'
  const languageLabel = isEnglish ? 'EN' : 'RU'
  const activeRegion = useMemo(
    () => REGION_OPTIONS.find((region) => region.code === selectedState) ?? REGION_OPTIONS[0],
    [selectedState],
  )
  const supportsPostalSearch = activeRegion.supportsPostalCode

  const availableCities = useMemo(
    () => [
      ...CITY_OPTIONS.filter((option) => option.state === selectedState),
      ...(customCity && customCity.state === selectedState ? [customCity] : []),
    ],
    [customCity, selectedState],
  )
  const activeCity = useMemo(
    () =>
      CITY_OPTIONS.find((option) => option.id === selectedCityId && option.state === selectedState) ??
      (customCity?.id === selectedCityId && customCity.state === selectedState ? customCity : null) ??
      availableCities[0] ??
      CITY_OPTIONS[0],
    [availableCities, customCity, selectedCityId, selectedState],
  )
  const activeCityLabel = useMemo(() => titleCasePlaceName(activeCity.city), [activeCity.city])
  const activeDataBounds = useMemo(() => activeCity.dataBounds ?? activeCity.bounds, [activeCity])
  const renderedCellSizeMeters = useMemo(
    () => renderedCellSizeForBounds(activeCity.bounds, appliedCellSizeMeters),
    [activeCity.bounds, appliedCellSizeMeters],
  )
  const deferredCellSizeMeters = useDeferredValue(renderedCellSizeMeters)
  const activeZoneCacheKey = useMemo(
    () => `${activeCity.id}:${boundsCachePart(activeDataBounds)}`,
    [activeCity.id, activeDataBounds],
  )
  const suggestedCityNames = useMemo(() => {
    const cityNames = new Set([
      ...(MAJOR_CITIES_BY_REGION[selectedState] ?? []),
      ...availableCities.map((city) => city.city),
    ])

    return [...cityNames].sort((a, b) => a.localeCompare(b))
  }, [availableCities, selectedState])

  const setLoadStage = useCallback((id: LoadStageId, patch: Partial<LoadStage>) => {
    setLoadStages((currentStages) => ({
      ...currentStages,
      [id]: {
        ...currentStages[id],
        ...patch,
      },
    }))
  }, [])

  const activateCustomCity = useCallback((city: CityConfig) => {
    setCustomCity(city)
    setSelectedCityId(city.id)
    setSelectedPoint(city.center)
    if (!city.id.startsWith('region-')) {
      setCitySearchText(city.city)
    }
    setSavedSites([])
    setCellSizeMeters(DEFAULT_CELL_SIZE_METERS)
    setAppliedCellSizeMeters(DEFAULT_CELL_SIZE_METERS)
  }, [])

  const applyRegionBounds = useCallback(
    (bounds: MapBounds) => {
      const center = centerForBounds(bounds)
      const baseLabel = activeCity.city.startsWith('Region ')
        ? activeCity.city.replace(/^Region\s+/, '')
        : activeCity.city
      const label = `Region ${titleCasePlaceName(baseLabel)}`
      const regionCity: CityConfig = {
        id: `region-${activeCity.state}-${boundsCachePart(bounds)}`,
        countryCode: activeCity.countryCode,
        state: activeCity.state,
        city: label,
        bounds,
        center,
        scoreCenter: scoreCenterForCity(activeCity),
        checkpoints: genericCityCheckpoints(label, bounds, center),
      }

      setSelectedRegionBounds(bounds)
      setIsRegionSelectMode(false)
      activateCustomCity(regionCity)
    },
    [activeCity, activateCustomCity],
  )

  useEffect(() => {
    const controller = new AbortController()
    const forceRefresh = forceRefreshZoneKey === activeZoneCacheKey
    const dataCity = { ...activeCity, bounds: activeDataBounds }
    const mainSnapshotKey = zoneSnapshotKey('main', dataCity)
    const hasBostonCrime = supportsBostonCrimeData(activeCity)
    const hasMassDotTraffic = supportsMassDotTrafficData(activeCity)
    const hasLocalRegistryRisk = supportsLocalRegistryRiskData(activeCity)

    Promise.resolve().then(() => {
      if (controller.signal.aborted) {
        return
      }

      if (!forceRefresh) {
        const snapshot = readZoneSnapshot<MainDataSnapshot>(mainSnapshotKey)

        if (snapshot) {
          setPois(snapshot.pois)
          setCrimeIncidents(snapshot.crimeIncidents)
          setRegistryRiskPoints(snapshot.registryRiskPoints ?? [])
          setNoiseSegments(snapshot.noiseSegments)
          setLandPenaltyAreas(snapshot.landPenaltyAreas)
          setTrafficSegments(snapshot.trafficSegments)
          setDataMode(snapshot.dataMode)
          setCrimeDataMode(snapshot.crimeDataMode)
          setRegistryDataMode(snapshot.registryDataMode ?? 'empty')
          setError(null)
          setIsLoading(false)
          setLoadStage('osm', {
            status: snapshot.dataMode === 'live' ? 'cached' : 'empty',
            count: snapshot.pois.length,
            detail: snapshot.dataMode === 'live' ? 'snapshot' : 'fallback',
          })
          setLoadStage('crime', {
            status: snapshot.crimeDataMode === 'live' ? 'cached' : 'empty',
            count: snapshot.crimeIncidents.length,
            detail: snapshot.crimeDataMode === 'live' ? 'snapshot' : hasBostonCrime ? 'Boston only' : 'unsupported',
          })
          setLoadStage('registry', {
            status: snapshot.registryDataMode === 'live' ? 'cached' : 'empty',
            count: snapshot.registryRiskPoints?.length ?? 0,
            detail:
              snapshot.registryDataMode === 'live' ? 'snapshot' : hasLocalRegistryRisk ? 'local dataset' : 'unsupported',
          })
          setLoadStage('noise', {
            status: snapshot.noiseSegments.length > 0 ? 'cached' : 'empty',
            count: snapshot.noiseSegments.length,
            detail: `${snapshot.landPenaltyAreas.length} caps`,
          })
          setLoadStage('traffic', {
            status: snapshot.trafficSegments.length > 0 ? 'cached' : 'empty',
            count: snapshot.trafficSegments.length,
            detail: snapshot.trafficSegments.length > 0 ? 'snapshot' : 'OSM road proxy',
          })
          return
        }
      }

      setPois([])
      setCrimeIncidents([])
      setRegistryRiskPoints([])
      setNoiseSegments([])
      setLandPenaltyAreas([])
      setTrafficSegments([])
      setDataMode('sample')
      setCrimeDataMode('empty')
      setRegistryDataMode('empty')
      setError(null)
      setIsLoading(true)
      setLoadStage('osm', { status: 'loading', count: undefined, detail: 'amenities + parks' })
      setLoadStage('crime', {
        status: hasBostonCrime ? 'loading' : 'empty',
        count: 0,
        detail: hasBostonCrime ? 'Boston live' : activeCity.countryCode === 'us' ? 'Boston only' : 'unsupported',
      })
      setLoadStage('registry', {
        status: hasLocalRegistryRisk ? 'loading' : 'empty',
        count: 0,
        detail: hasLocalRegistryRisk ? 'sanitized local' : 'unsupported',
      })
      setLoadStage('noise', { status: 'loading', count: undefined, detail: 'roads + masks' })
      setLoadStage('traffic', {
        status: 'loading',
        count: 0,
        detail: hasMassDotTraffic ? 'MassDOT AADT' : 'OSM road proxy',
      })
    })

    const poisPromise = fetchPois(controller.signal, activeDataBounds, forceRefresh)
    const crimePromise = hasBostonCrime
      ? fetchCrimeIncidents(controller.signal, activeDataBounds, forceRefresh)
      : Promise.resolve([])
    const registryPromise = hasLocalRegistryRisk
      ? fetchRegistryRiskPoints(controller.signal, activeDataBounds, forceRefresh)
      : Promise.resolve([])
    const noisePromise = fetchNoiseSegments(controller.signal, activeDataBounds, forceRefresh)
    const trafficPromise = hasMassDotTraffic
      ? fetchTrafficSegments(controller.signal, activeDataBounds, forceRefresh)
      : Promise.resolve([])
    let osmTrafficProxy: TrafficSegment[] = []
    let hasLiveTraffic = false

    poisPromise
      .then((nextPois) => {
        if (controller.signal.aborted) {
          return
        }

        const nextDataMode: DataMode = nextPois.length > 0 ? 'live' : 'sample'

        setPois(nextPois.length > 0 ? nextPois : activeCity.id === 'ma-boston' ? FALLBACK_POIS : [])
        setDataMode(nextDataMode)
        setLoadStage('osm', {
          status: nextPois.length > 0 ? 'live' : activeCity.id === 'ma-boston' ? 'partial' : 'empty',
          count: nextPois.length,
          detail: nextPois.length > 0 ? 'loaded' : activeCity.id === 'ma-boston' ? 'fallback' : 'no amenities',
        })
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return
        }

        const fallbackPois = activeCity.id === 'ma-boston' ? FALLBACK_POIS : []

        setPois(fallbackPois)
        setDataMode('sample')
        setLoadStage('osm', {
          status: fallbackPois.length > 0 ? 'partial' : 'error',
          count: fallbackPois.length,
          detail: fallbackPois.length > 0 ? 'fallback' : 'unavailable',
        })
      })

    crimePromise
      .then((nextCrimeIncidents) => {
        if (controller.signal.aborted) {
          return
        }

        setCrimeIncidents(nextCrimeIncidents)
        setCrimeDataMode(nextCrimeIncidents.length > 0 ? 'live' : 'empty')
        setLoadStage('crime', {
          status: nextCrimeIncidents.length > 0 ? 'live' : 'empty',
          count: nextCrimeIncidents.length,
          detail:
            nextCrimeIncidents.length > 0
              ? 'loaded'
              : hasBostonCrime
                ? 'Boston only'
                : activeCity.countryCode === 'us'
                  ? 'Boston only'
                  : 'unsupported',
        })
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return
        }

        setCrimeIncidents([])
        setCrimeDataMode('empty')
        setLoadStage('crime', { status: 'error', count: 0, detail: 'unavailable' })
      })

    registryPromise
      .then((nextRegistryRiskPoints) => {
        if (controller.signal.aborted) {
          return
        }

        setRegistryRiskPoints(nextRegistryRiskPoints)
        setRegistryDataMode(nextRegistryRiskPoints.length > 0 ? 'live' : 'empty')
        setLoadStage('registry', {
          status: nextRegistryRiskPoints.length > 0 ? 'live' : 'empty',
          count: nextRegistryRiskPoints.length,
          detail:
            nextRegistryRiskPoints.length > 0
              ? 'loaded'
              : hasLocalRegistryRisk
                ? 'no local points'
                : 'unsupported',
        })
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return
        }

        setRegistryRiskPoints([])
        setRegistryDataMode('empty')
        setLoadStage('registry', { status: 'error', count: 0, detail: 'unavailable' })
      })

    noisePromise
      .then((nextNoise) => {
        if (controller.signal.aborted) {
          return
        }

        setNoiseSegments(nextNoise.segments)
        setLandPenaltyAreas(nextNoise.areas)
        setLoadStage('noise', {
          status: nextNoise.segments.length > 0 || nextNoise.areas.length > 0 ? 'live' : 'empty',
          count: nextNoise.segments.length,
          detail: `${nextNoise.areas.length} caps`,
        })

        osmTrafficProxy = trafficSegmentsFromOsmRoads(nextNoise.segments)

        if (!hasLiveTraffic) {
          setTrafficSegments(osmTrafficProxy)
          setLoadStage('traffic', {
            status: osmTrafficProxy.length > 0 ? 'partial' : hasMassDotTraffic ? 'loading' : 'empty',
            count: osmTrafficProxy.length,
            detail:
              osmTrafficProxy.length > 0
                ? 'OSM proxy'
                : hasMassDotTraffic
                  ? 'MassDOT AADT'
                  : 'no roads',
          })
        }
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return
        }

        setNoiseSegments([])
        setLandPenaltyAreas([])
        setLoadStage('noise', { status: 'error', count: 0, detail: 'unavailable' })
      })

    trafficPromise
      .then((nextTrafficSegments) => {
        if (controller.signal.aborted) {
          return
        }

        hasLiveTraffic = nextTrafficSegments.length > 0

        if (hasLiveTraffic) {
          setTrafficSegments(nextTrafficSegments)
          setLoadStage('traffic', {
            status: 'live',
            count: nextTrafficSegments.length,
            detail: hasMassDotTraffic ? 'loaded' : 'no roads',
          })
        } else if (osmTrafficProxy.length > 0) {
          setTrafficSegments(osmTrafficProxy)
          setLoadStage('traffic', {
            status: 'partial',
            count: osmTrafficProxy.length,
            detail: 'OSM proxy',
          })
        } else {
          setTrafficSegments([])
          setLoadStage('traffic', {
            status: hasMassDotTraffic ? 'loading' : 'empty',
            count: 0,
            detail: hasMassDotTraffic ? 'MassDOT AADT' : 'no roads',
          })
        }
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return
        }

        if (osmTrafficProxy.length > 0) {
          setTrafficSegments(osmTrafficProxy)
          setLoadStage('traffic', {
            status: 'partial',
            count: osmTrafficProxy.length,
            detail: 'OSM proxy',
          })
          return
        }

        setTrafficSegments([])
        setLoadStage('traffic', { status: 'error', count: 0, detail: 'unavailable' })
      })

    Promise.allSettled([
      poisPromise,
      crimePromise,
      registryPromise,
      noisePromise,
      trafficPromise,
    ])
      .then(([poiResult, crimeResult, registryResult, noiseResult, trafficResult]) => {
        if (controller.signal.aborted) {
          return
        }

        const errors: string[] = []
        const nextPois =
          poiResult.status === 'fulfilled' && poiResult.value.length > 0
            ? poiResult.value
            : activeCity.id === 'ma-boston'
              ? FALLBACK_POIS
              : []
        const nextDataMode: DataMode =
          poiResult.status === 'fulfilled' && poiResult.value.length > 0 ? 'live' : 'sample'
        const nextCrimeIncidents = crimeResult.status === 'fulfilled' ? crimeResult.value : []
        const nextCrimeDataMode: CrimeDataMode =
          crimeResult.status === 'fulfilled' && crimeResult.value.length > 0 ? 'live' : 'empty'
        const nextRegistryRiskPoints = registryResult.status === 'fulfilled' ? registryResult.value : []
        const nextRegistryDataMode: RegistryDataMode =
          registryResult.status === 'fulfilled' && registryResult.value.length > 0 ? 'live' : 'empty'
        const nextNoiseSegments =
          noiseResult.status === 'fulfilled' ? noiseResult.value.segments : []
        const nextLandPenaltyAreas =
          noiseResult.status === 'fulfilled' ? noiseResult.value.areas : []
        const fallbackTrafficSegments =
          noiseResult.status === 'fulfilled'
            ? trafficSegmentsFromOsmRoads(noiseResult.value.segments)
            : []
        const nextTrafficSegments =
          trafficResult.status === 'fulfilled' && trafficResult.value.length > 0
            ? trafficResult.value
            : fallbackTrafficSegments
        const trafficUsesFallback =
          nextTrafficSegments.length > 0 &&
          !(trafficResult.status === 'fulfilled' && trafficResult.value.length > 0)

        if (poiResult.status === 'fulfilled' && poiResult.value.length > 0) {
          setPois(nextPois)
          setDataMode(nextDataMode)
          setLoadStage('osm', { status: 'live', count: nextPois.length, detail: 'loaded' })
        } else if (poiResult.status === 'fulfilled') {
          setPois(nextPois)
          setDataMode(nextDataMode)
          setLoadStage('osm', {
            status: nextPois.length > 0 ? 'partial' : 'empty',
            count: nextPois.length,
            detail: nextPois.length > 0 ? 'fallback' : 'no amenities',
          })
        } else {
          setPois(nextPois)
          setDataMode(nextDataMode)
          setLoadStage('osm', {
            status: nextPois.length > 0 ? 'partial' : 'error',
            count: nextPois.length,
            detail: nextPois.length > 0 ? 'fallback' : 'unavailable',
          })
          errors.push('OSM')
        }

        if (crimeResult.status === 'fulfilled') {
          setCrimeIncidents(nextCrimeIncidents)
          setCrimeDataMode(nextCrimeDataMode)
          setLoadStage('crime', {
            status: nextCrimeIncidents.length > 0 ? 'live' : 'empty',
            count: nextCrimeIncidents.length,
            detail:
              nextCrimeIncidents.length > 0
                ? 'loaded'
                : hasBostonCrime
                  ? 'Boston only'
                  : activeCity.countryCode === 'us'
                    ? 'Boston only'
                    : 'unsupported',
          })
        } else {
          setCrimeIncidents(nextCrimeIncidents)
          setCrimeDataMode(nextCrimeDataMode)
          setLoadStage('crime', { status: 'error', count: 0, detail: 'unavailable' })
          errors.push('crime')
        }

        if (registryResult.status === 'fulfilled') {
          setRegistryRiskPoints(nextRegistryRiskPoints)
          setRegistryDataMode(nextRegistryDataMode)
          setLoadStage('registry', {
            status: nextRegistryRiskPoints.length > 0 ? 'live' : 'empty',
            count: nextRegistryRiskPoints.length,
            detail:
              nextRegistryRiskPoints.length > 0
                ? 'loaded'
                : hasLocalRegistryRisk
                  ? 'no local points'
                  : 'unsupported',
          })
        } else {
          setRegistryRiskPoints([])
          setRegistryDataMode('empty')
          setLoadStage('registry', { status: 'error', count: 0, detail: 'unavailable' })
          errors.push('registry')
        }

        if (noiseResult.status === 'fulfilled') {
          setNoiseSegments(nextNoiseSegments)
          setLandPenaltyAreas(nextLandPenaltyAreas)
          setLoadStage('noise', {
            status: nextNoiseSegments.length > 0 || nextLandPenaltyAreas.length > 0 ? 'live' : 'empty',
            count: nextNoiseSegments.length,
            detail: `${nextLandPenaltyAreas.length} caps`,
          })
        } else {
          setNoiseSegments(nextNoiseSegments)
          setLandPenaltyAreas(nextLandPenaltyAreas)
          setLoadStage('noise', { status: 'error', count: 0, detail: 'unavailable' })
          errors.push('noise')
        }

        if (trafficResult.status === 'fulfilled') {
          setTrafficSegments(nextTrafficSegments)
          setLoadStage('traffic', {
            status: trafficUsesFallback ? 'partial' : nextTrafficSegments.length > 0 ? 'live' : 'empty',
            count: nextTrafficSegments.length,
            detail: trafficUsesFallback ? 'OSM proxy' : hasMassDotTraffic ? 'loaded' : 'no roads',
          })
        } else if (trafficUsesFallback) {
          setTrafficSegments(nextTrafficSegments)
          setLoadStage('traffic', {
            status: 'partial',
            count: nextTrafficSegments.length,
            detail: 'OSM proxy',
          })
        } else {
          setTrafficSegments(nextTrafficSegments)
          setLoadStage('traffic', { status: 'error', count: 0, detail: 'unavailable' })
          errors.push('traffic')
        }

        const hasFreshSource =
          poiResult.status === 'fulfilled' ||
          registryResult.status === 'fulfilled' ||
          noiseResult.status === 'fulfilled' ||
          (hasBostonCrime && crimeResult.status === 'fulfilled') ||
          (hasMassDotTraffic && trafficResult.status === 'fulfilled')

        if (hasFreshSource) {
          writeZoneSnapshot<MainDataSnapshot>(mainSnapshotKey, {
            pois: nextPois,
            crimeIncidents: nextCrimeIncidents,
            registryRiskPoints: nextRegistryRiskPoints,
            noiseSegments: nextNoiseSegments,
            landPenaltyAreas: nextLandPenaltyAreas,
            trafficSegments: nextTrafficSegments,
            dataMode: nextDataMode,
            crimeDataMode: nextCrimeDataMode,
            registryDataMode: nextRegistryDataMode,
          })
        }

        setError(errors.length > 0 ? `${errors.join(' + ')} data unavailable` : null)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      })

    return () => controller.abort()
  }, [activeCity, activeDataBounds, activeZoneCacheKey, forceRefreshZoneKey, refreshToken, setLoadStage])

  useEffect(() => {
    const controller = new AbortController()
    let isCurrent = true
    const forceRefresh = forceRefreshZoneKey === activeZoneCacheKey
    const dataCity = { ...activeCity, bounds: activeDataBounds }
    const buildingSnapshotKey = zoneSnapshotKey('buildings', dataCity)

    Promise.resolve()
      .then(() => {
        if (!isCurrent) {
          throw new Error('stale')
        }

        if (!forceRefresh) {
          const snapshot = readZoneSnapshot<BuildingDataSnapshot>(buildingSnapshotKey)

          if (snapshot) {
            const snapshotTotal = snapshot.buildingTotalCount ?? snapshot.buildingFootprints.length
            const snapshotIsCapped = snapshot.buildingIsCapped ?? false

            setBuildingFootprints(snapshot.buildingFootprints)
            setBuildingDataMode(snapshot.buildingDataMode)
            setBuildingTotalCount(snapshotTotal)
            setBuildingIsCapped(snapshotIsCapped)
            setLoadStage('buildings', {
              status:
                snapshot.buildingDataMode === 'partial'
                  ? 'partial'
                  : snapshot.buildingDataMode === 'empty'
                    ? 'empty'
                    : 'cached',
              count: snapshot.buildingFootprints.length,
              detail: snapshotIsCapped
                ? `${snapshot.buildingFootprints.length}/${snapshotTotal}`
                : 'snapshot',
            })
          } else {
            setBuildingFootprints([])
            setBuildingDataMode('loading')
            setBuildingTotalCount(0)
            setBuildingIsCapped(false)
            setLoadStage('buildings', { status: 'loading', count: undefined, detail: 'OSM buildings' })
          }
        } else {
          setBuildingFootprints([])
          setBuildingDataMode('loading')
          setBuildingTotalCount(0)
          setBuildingIsCapped(false)
          setLoadStage('buildings', { status: 'loading', count: undefined, detail: 'force refresh' })
        }

        return fetchBuildingFootprints(controller.signal, activeDataBounds, forceRefresh)
      })
      .then((result) => {
        if (controller.signal.aborted || !isCurrent) {
          return
        }

        const nextMode: Exclude<BuildingDataMode, 'loading'> =
          result.buildings.length > 0 ? 'live' : 'empty'

        setBuildingFootprints(result.buildings)
        setBuildingDataMode(nextMode)
        setBuildingTotalCount(result.total)
        setBuildingIsCapped(result.isCapped)
        setLoadStage('buildings', {
          status: nextMode,
          count: result.buildings.length,
          detail: result.isCapped ? `${result.buildings.length}/${result.total}` : 'loaded',
        })
        writeZoneSnapshot<BuildingDataSnapshot>(buildingSnapshotKey, {
          buildingFootprints: result.buildings,
          buildingDataMode: nextMode,
          buildingTotalCount: result.total,
          buildingIsCapped: result.isCapped,
        })
      })
      .catch(() => {
        if (controller.signal.aborted || !isCurrent) {
          return
        }

        const snapshot = !forceRefresh
          ? readZoneSnapshot<BuildingDataSnapshot>(buildingSnapshotKey)
          : null

        if (snapshot) {
          const snapshotTotal = snapshot.buildingTotalCount ?? snapshot.buildingFootprints.length
          const snapshotIsCapped = snapshot.buildingIsCapped ?? false

          setBuildingFootprints(snapshot.buildingFootprints)
          setBuildingDataMode(snapshot.buildingDataMode)
          setBuildingTotalCount(snapshotTotal)
          setBuildingIsCapped(snapshotIsCapped)
          setLoadStage('buildings', {
            status:
              snapshot.buildingDataMode === 'partial'
                ? 'partial'
                : snapshot.buildingDataMode === 'empty'
                  ? 'empty'
                  : 'cached',
            count: snapshot.buildingFootprints.length,
            detail: snapshotIsCapped
              ? `${snapshot.buildingFootprints.length}/${snapshotTotal}`
              : 'snapshot',
          })
        } else {
          setBuildingFootprints([])
          setBuildingDataMode('empty')
          setBuildingTotalCount(0)
          setBuildingIsCapped(false)
          setLoadStage('buildings', { status: 'error', count: 0, detail: 'unavailable' })
        }
      })

    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [activeCity, activeDataBounds, activeZoneCacheKey, forceRefreshZoneKey, refreshToken, setLoadStage])

  const refreshData = useCallback(() => {
    setIsLoading(true)
    setError(null)
    setForceRefreshZoneKey(activeZoneCacheKey)
    setRefreshToken((token) => token + 1)
  }, [activeZoneCacheKey])

  const searchCity = useCallback(() => {
    setIsSearchingCity(true)
    setError(null)

    fetchCityConfig(selectedState, citySearchText)
      .then((city) => {
        setSelectedRegionBounds(null)
        activateCustomCity(city)
      })
      .catch(() => {
        setError('City not found')
      })
      .finally(() => {
        setIsSearchingCity(false)
      })
  }, [activateCustomCity, citySearchText, selectedState])

  const searchZip = useCallback(() => {
    if (!supportsPostalSearch) {
      return
    }

    setIsSearchingZip(true)
    setError(null)

    fetchZipConfig(selectedState, zipSearchText)
      .then((city) => {
        setSelectedRegionBounds(null)
        activateCustomCity(city)
      })
      .catch(() => {
        setError('ZIP not found')
      })
      .finally(() => {
        setIsSearchingZip(false)
      })
  }, [activateCustomCity, selectedState, supportsPostalSearch, zipSearchText])

  const poisByCategory = useMemo(
    () =>
      ({
        parks: pois.filter((poi) => poi.category === 'parks'),
        groceries: pois.filter((poi) => poi.category === 'groceries'),
        noise: dataMode === 'live' ? pois.filter((poi) => poi.category === 'noise') : [],
        transit: pois.filter((poi) => poi.category === 'transit'),
      }) satisfies Record<PoiCategory, Poi[]>,
    [dataMode, pois],
  )

  const spatialFactorField = useMemo(
    () =>
      buildSpatialFactorField(
        poisByCategory,
        crimeIncidents,
        registryRiskPoints,
        noiseSegments,
        landPenaltyAreas,
        trafficSegments,
        activeCity.bounds,
        activeCity.boundaryAreas,
        scoreCenterForCity(activeCity),
        deferredCellSizeMeters,
      ),
    [
      activeCity,
      deferredCellSizeMeters,
      crimeIncidents,
      registryRiskPoints,
      landPenaltyAreas,
      noiseSegments,
      poisByCategory,
      trafficSegments,
    ],
  )

  const buildingEligibilityActive = useMemo(
    () =>
      (buildingDataMode === 'live' || buildingDataMode === 'partial') &&
      buildingFootprints.some((building) => building.use !== 'nonResidential'),
    [buildingDataMode, buildingFootprints],
  )

  const residentialEvidence = useMemo(
    () =>
      buildResidentialEvidenceField(
        spatialFactorField,
        buildingFootprints,
        buildingEligibilityActive,
      ),
    [buildingEligibilityActive, buildingFootprints, spatialFactorField],
  )

  const suitabilityField = useMemo(
    () =>
      mixSuitabilityField(
        deferredCriteria,
        spatialFactorField,
        residentialEvidence,
      ),
    [deferredCriteria, residentialEvidence, spatialFactorField],
  )

  const neighborhoodScores = useMemo(
    () =>
      activeCity.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        score: scoreAt(suitabilityField, checkpoint),
      })).sort((a, b) => b.score - a.score),
    [activeCity.checkpoints, suitabilityField],
  )

  const visiblePois = useMemo(
    () =>
      pois.filter((poi) => {
        const matchingCriterion = criteria.find((criterion) => criterion.id === poi.category)
        return matchingCriterion?.enabled
      }),
    [criteria, pois],
  )

  const updateCriterion = useCallback((id: CriterionId, patch: Partial<Criterion>) => {
    setCriteria((currentCriteria) =>
      currentCriteria.map((criterion) =>
        criterion.id === id ? { ...criterion, ...patch } : criterion,
      ),
    )
  }, [])

  const applyProfile = useCallback((profile: EvaluationProfile) => {
    setActiveProfileId(profile.id)
    setCriteria((currentCriteria) =>
      currentCriteria.map((criterion) => ({
        ...criterion,
        weight: profile.weights[criterion.id] ?? criterion.weight,
      })),
    )
  }, [])

  const applyGridResolution = useCallback(() => {
    setAppliedCellSizeMeters(cellSizeMeters)
  }, [cellSizeMeters])
  const renderedGridIsThrottled = renderedCellSizeMeters > appliedCellSizeMeters

  const dataCoverage = useMemo(() => {
    const sourceScores = [
      dataMode === 'live' ? 1 : 0.42,
      noiseSegments.length > 0 ? 1 : 0,
      landPenaltyAreas.length > 0 ? 1 : 0,
      trafficSegments.length > 0 ? 1 : 0,
    ]

    if (supportsBostonCrimeData(activeCity)) {
      sourceScores.push(crimeDataMode === 'live' ? 1 : 0)
    }

    if (supportsLocalRegistryRiskData(activeCity)) {
      sourceScores.push(registryDataMode === 'live' ? 1 : 0.5)
    }

    return sourceScores.reduce((total, score) => total + score, 0) / sourceScores.length
  }, [
    activeCity,
    crimeDataMode,
    dataMode,
    landPenaltyAreas.length,
    noiseSegments.length,
    registryDataMode,
    trafficSegments.length,
  ])

  const loadProgress = useMemo(() => {
    const stages = Object.values(loadStages)
    const scoreForStatus = (status: LoadStageStatus) => {
      if (status === 'loading') {
        return 0.35
      }

      if (status === 'idle') {
        return 0
      }

      if (status === 'error') {
        return 0.65
      }

      if (status === 'partial') {
        return 0.85
      }

      return 1
    }
    const score = stages.reduce((total, stage) => total + scoreForStatus(stage.status), 0)

    return Math.round((score / stages.length) * 100)
  }, [loadStages])

  const loadingHeadline = useMemo(() => {
    const loadingStage = Object.values(loadStages).find((stage) => stage.status === 'loading')

    if (loadingStage) {
      return `${loadingStage.label}: loading`
    }

    if (Object.values(loadStages).some((stage) => stage.status === 'error')) {
      return 'Loaded with gaps'
    }

    if (Object.values(loadStages).some((stage) => stage.status === 'partial')) {
      return 'Partially loaded'
    }

    return 'Data ready'
  }, [loadStages])

  const overlayIsResolving =
    isLoading ||
    loadProgress < 100 ||
    residentialEvidence.isProvisionalEligibility ||
    Object.values(loadStages).some((stage) => stage.status === 'loading')

  const selectedAnalysis = useMemo(
    () =>
      analyzePoint(
        selectedPoint,
        activeCity,
        criteria,
        suitabilityField,
        poisByCategory,
        crimeIncidents,
        registryRiskPoints,
        noiseSegments,
        landPenaltyAreas,
        trafficSegments,
        dataCoverage,
      ),
    [
      crimeIncidents,
      registryRiskPoints,
      activeCity,
      criteria,
      dataCoverage,
      landPenaltyAreas,
      noiseSegments,
      poisByCategory,
      selectedPoint,
      suitabilityField,
      trafficSegments,
    ],
  )

  const selectedBuilding = useMemo(
    () => nearestBuildingDetail(selectedPoint, buildingFootprints, suitabilityField),
    [buildingFootprints, selectedPoint, suitabilityField],
  )
  const floorMatch =
    selectedBuilding.building?.levels === null || !selectedBuilding.building
      ? null
      : selectedBuilding.building.levels >= desiredFloor
  const selectedSiteId = `${selectedAnalysis.point.lat.toFixed(5)}-${selectedAnalysis.point.lng.toFixed(5)}`
  const isSelectedSitePinned = savedSites.some((site) => site.id === selectedSiteId)

  const opportunityZones = useMemo(
    () =>
      neighborhoodScores
        .map((item) => ({
          ...item,
          analysis: analyzePoint(
            item,
            activeCity,
            criteria,
            suitabilityField,
            poisByCategory,
            crimeIncidents,
            registryRiskPoints,
            noiseSegments,
            landPenaltyAreas,
            trafficSegments,
            dataCoverage,
          ),
        }))
        .sort((a, b) => b.analysis.opportunityScore - a.analysis.opportunityScore),
    [
      crimeIncidents,
      registryRiskPoints,
      activeCity,
      criteria,
      dataCoverage,
      landPenaltyAreas,
      neighborhoodScores,
      noiseSegments,
      poisByCategory,
      suitabilityField,
      trafficSegments,
    ],
  )

  const addSelectedSite = useCallback(() => {
    setSavedSites((currentSites) => {
      const nextSite: SavedSite = {
        ...selectedAnalysis,
        id: selectedSiteId,
        name: `Point ${currentSites.length + 1}`,
      }

      if (currentSites.some((site) => site.id === nextSite.id)) {
        return currentSites
      }

      return [...currentSites, nextSite].slice(-5)
    })
  }, [selectedAnalysis, selectedSiteId])

  const averageScore = suitabilityField.averageScore
  const hasEvaluatedCells = suitabilityField.evaluatedCellCount > 0

  const exportReport = useCallback(() => {
    const report = {
      generatedAt: new Date().toISOString(),
      profile: activeProfileId,
      location: { state: activeCity.state, city: activeCity.city, scoreCenter: scoreCenterForCity(activeCity) },
      gridMeters: appliedCellSizeMeters,
      renderedGridMeters: renderedCellSizeMeters,
      averageScore: hasEvaluatedCells ? averageScore : null,
      selected: selectedAnalysis,
      shortlist: savedSites,
      topZones: neighborhoodScores.slice(0, 8),
      sources: {
        osmAmenities: dataMode,
        crime: crimeDataMode,
        registry: registryDataMode,
        registryRiskPoints: registryRiskPoints.length,
        noiseSegments: noiseSegments.length,
        landPenaltyAreas: landPenaltyAreas.length,
        trafficSegments: trafficSegments.length,
        buildings: buildingFootprints.length,
        buildingTotal: buildingTotalCount,
        buildingsCapped: buildingIsCapped,
      },
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = `${activeCity.state.toLowerCase()}-${slugifyFilePart(activeCity.city)}-housing-score-report.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [
    activeProfileId,
    activeCity,
    averageScore,
    appliedCellSizeMeters,
    renderedCellSizeMeters,
    buildingFootprints.length,
    buildingIsCapped,
    buildingTotalCount,
    crimeDataMode,
    dataMode,
    hasEvaluatedCells,
    landPenaltyAreas.length,
    neighborhoodScores,
    noiseSegments.length,
    registryDataMode,
    registryRiskPoints.length,
    savedSites,
    selectedAnalysis,
    trafficSegments.length,
  ])

  const mapTopBar = (
    <div className="map-topbar" aria-label="Search and panels">
      <button
        className="icon-button"
        type="button"
        onClick={() => setIsLeftPanelOpen((current) => !current)}
        aria-label={
          isLeftPanelOpen
            ? isEnglish
              ? 'Hide filters'
              : 'Hide filters'
            : isEnglish
              ? 'Show filters'
              : 'Show filters'
        }
        title={
          isLeftPanelOpen
            ? isEnglish
              ? 'Hide filters'
              : 'Hide filters'
            : isEnglish
              ? 'Show filters'
              : 'Show filters'
        }
      >
        {isLeftPanelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </button>
      <div className="map-search">
        <Search size={16} />
        <select
          aria-label="Region"
          value={selectedState}
          onChange={(event) => {
            const nextState = event.target.value
            const nextCity = CITY_OPTIONS.find((option) => option.state === nextState)

            setSelectedState(nextState)
            setCustomCity(null)
            setSelectedRegionBounds(null)
            setSelectedCityId(nextCity?.id ?? '')
            if (nextCity) {
              setSelectedPoint(nextCity.center)
            }
            setCitySearchText(MAJOR_CITIES_BY_REGION[nextState]?.[0] ?? '')
            setZipSearchText('')
          }}
        >
          {REGION_OPTIONS.map((region) => (
            <option key={region.code} value={region.code}>
              {region.code}
            </option>
          ))}
        </select>
        <input
          aria-label="City or area"
          list="major-city-options"
          placeholder={activeCityLabel}
          type="text"
          value={citySearchText}
          onChange={(event) => setCitySearchText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              searchCity()
            }
          }}
        />
        <datalist id="major-city-options">
          {suggestedCityNames.map((city) => (
            <option key={`${selectedState}-${city}`} value={city} />
          ))}
        </datalist>
        <button
          className="icon-button"
          disabled={isSearchingCity || citySearchText.trim().length === 0}
          type="button"
          onClick={searchCity}
          aria-label={isEnglish ? 'Find city' : 'Find city'}
          title={isEnglish ? 'Find city' : 'Find city'}
        >
          {isSearchingCity ? <Loader2 className="spin" size={15} /> : <MapPin size={15} />}
        </button>
        {supportsPostalSearch ? (
          <>
            <input
              aria-label="ZIP code"
              inputMode="numeric"
              placeholder="ZIP"
              type="text"
              value={zipSearchText}
              onChange={(event) => setZipSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  searchZip()
                }
              }}
            />
            <button
              className="icon-button"
              disabled={isSearchingZip || !isUsZipCode(zipSearchText)}
              type="button"
              onClick={searchZip}
              aria-label={isEnglish ? 'Find ZIP code' : 'Find ZIP'}
              title={isEnglish ? 'Find ZIP code' : 'Find ZIP'}
            >
              {isSearchingZip ? <Loader2 className="spin" size={15} /> : <MapPin size={15} />}
            </button>
          </>
        ) : null}
      </div>
      <button
        className={`icon-button ${isRegionSelectMode ? 'active' : ''}`}
        type="button"
        onClick={() => {
          setDraftRegionBounds(null)
          setIsRegionSelectMode((current) => !current)
        }}
        aria-label={isEnglish ? 'Select region' : 'Select region'}
        title={isEnglish ? 'Select region' : 'Select region'}
      >
        <Target size={15} />
      </button>
      <button
        className="icon-button"
        type="button"
        onClick={refreshData}
        aria-label={isEnglish ? 'Refresh data' : 'Refresh data'}
        title={isEnglish ? 'Refresh data' : 'Refresh data'}
      >
        {isLoading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
      </button>
      <button
        className="language-toggle"
        type="button"
        onClick={() => setAppLanguage((current) => (current === 'ru' ? 'en' : 'ru'))}
        aria-label={isEnglish ? 'Switch to Russian' : 'Switch to English'}
        title={isEnglish ? 'Switch to Russian' : 'Switch to English'}
      >
        <Languages size={15} />
        {languageLabel}
      </button>
      <button
        className="icon-button"
        type="button"
        onClick={() => setIsInspectorOpen((current) => !current)}
        aria-label={
          isInspectorOpen
            ? isEnglish
              ? 'Hide inspector'
              : 'Hide inspector'
            : isEnglish
              ? 'Show inspector'
              : 'Show inspector'
        }
        title={
          isInspectorOpen
            ? isEnglish
              ? 'Hide inspector'
              : 'Hide inspector'
            : isEnglish
              ? 'Show inspector'
              : 'Show inspector'
        }
      >
        {isInspectorOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
      </button>
    </div>
  )

  const pointInspector = (
    <aside className="inspector-panel" aria-label="Point inspector">
      <header className="inspector-header">
        <div>
          <p className="eyebrow">Point</p>
          <h2>{selectedAnalysis.label}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => setIsInspectorOpen(false)}
          aria-label="Hide inspector"
          title="Hide inspector"
        >
          <PanelRightClose size={18} />
        </button>
      </header>

      <div className="inspector-score">
        <span
          className="inspector-score-value"
          style={{ backgroundColor: colorForScore(selectedAnalysis.score) }}
        >
          {Math.round(selectedAnalysis.score * 100)}
        </span>
        <div>
          <span>Risk {Math.round(selectedAnalysis.riskScore * 100)}</span>
          <strong>Confidence {Math.round(selectedAnalysis.confidence * 100)}%</strong>
        </div>
      </div>

      <section className="panel-section analysis-card">
        <div className="analysis-head">
          <div>
            <span className="mini-label">Coordinates</span>
            <strong>
              {selectedAnalysis.point.lat.toFixed(5)}, {selectedAnalysis.point.lng.toFixed(5)}
            </strong>
          </div>
        </div>
        <p className="thesis">{selectedAnalysis.thesis}</p>
        <PointCompletenessPanel
          analysis={selectedAnalysis}
          building={selectedBuilding.building}
          buildingDataMode={buildingDataMode}
          buildingDistance={selectedBuilding.distance}
          city={activeCity}
        />
        <div className="point-context">
          <div>
            <span>Upside</span>
            <strong>{selectedAnalysis.bestFactor.detail}</strong>
          </div>
          <div>
            <span>Risk</span>
            <strong>{selectedAnalysis.worstFactor.detail}</strong>
          </div>
          <div>
            <span>Building</span>
            <strong>
              {selectedBuilding.building
                ? `${selectedBuilding.building.levels ?? '?'} fl. · ${formatMeters(selectedBuilding.distance)}`
                : 'no data'}
            </strong>
          </div>
        </div>
        <div className="factor-list">
          {selectedAnalysis.factors.map((factor) => (
            <div className="factor-row" key={factor.id}>
              <div className="factor-meta">
                <span>{factor.label}</span>
                <strong>{Math.round(factor.score * 100)}</strong>
              </div>
              <div className="factor-track">
                <span
                  className="factor-fill"
                  style={{
                    width: `${Math.round(factor.score * 100)}%`,
                    backgroundColor: colorForScore(factor.score),
                  }}
                />
              </div>
              <small>{factor.detail}</small>
            </div>
          ))}
        </div>
        <div className="action-row">
          <button
            className="text-button"
            disabled={isSelectedSitePinned}
            type="button"
            onClick={addSelectedSite}
          >
            <Star size={16} />
            {isSelectedSitePinned ? 'Pinned' : 'Pin'}
          </button>
          <button className="text-button" type="button" onClick={exportReport}>
            <Download size={16} />
            Export
          </button>
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title">
          <span>Pinned sites</span>
          <Star size={16} />
        </div>
        <div className="shortlist">
          {savedSites.length > 0 ? (
            savedSites.map((site) => (
              <div className="shortlist-row" key={site.id}>
                <MapPin size={15} />
                <span>{site.name}</span>
                <strong>{Math.round(site.score * 100)}</strong>
              </div>
            ))
          ) : (
            <p className="empty-note">No pinned points.</p>
          )}
        </div>
      </section>
    </aside>
  )

  return (
    <div
      className={`app-shell ${isLeftPanelOpen ? '' : 'left-collapsed'} ${
        isInspectorOpen ? '' : 'right-collapsed'
      }`}
    >
      <aside className="control-panel" aria-label="Map settings">
        <header className="panel-header">
          <div>
            <p className="eyebrow">{activeCity.state}</p>
            <h1>{shellTitle}</h1>
          </div>
        </header>

        <section className="load-panel" aria-label="Load status">
          <div className="load-head">
            <strong>{loadingHeadline}</strong>
            <span>{loadProgress}%</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${loadProgress}%` }} />
          </div>
          <div className="load-grid">
            {(Object.keys(loadStages) as LoadStageId[]).map((stageId) => {
              const stage = loadStages[stageId]

              return (
                <div className={`load-row ${stage.status}`} key={stageId}>
                  <span>{stage.label}</span>
                  <strong>{loadStatusText(stage)}</strong>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Region</span>
            <SlidersHorizontal size={16} />
          </div>
          <div className="source-grid">
            <span>Active</span>
            <strong>{activeCityLabel}, {activeCity.state}</strong>
            <span>Selection</span>
            <strong>
              {selectedRegionBounds
                ? formatBoundsSummary(selectedRegionBounds)
                : isRegionSelectMode
                  ? 'selecting'
                  : 'none'}
            </strong>
          </div>
          <label className="range-row">
            <span>Grid</span>
            <select
              value={cellSizeMeters}
              onChange={(event) => setCellSizeMeters(Number(event.target.value))}
            >
              {RESOLUTION_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} m
                </option>
              ))}
            </select>
          </label>
          <div className="resolution-row">
            <span>
              {cellSizeMeters === appliedCellSizeMeters
                ? `Active: ${appliedCellSizeMeters} m`
                : `Selected: ${cellSizeMeters} m`}
              {renderedGridIsThrottled ? ` · rendered ${renderedCellSizeMeters} m` : ''}
            </span>
            <button
              className="text-button"
              disabled={cellSizeMeters === appliedCellSizeMeters}
              type="button"
              onClick={applyGridResolution}
            >
              Apply
            </button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Floor model</span>
            <Building2 size={16} />
          </div>
          <label className="range-row">
            <span>Floor</span>
            <input
              max="80"
              min="1"
              type="range"
              value={desiredFloor}
              onChange={(event) => setDesiredFloor(Number(event.target.value))}
            />
          </label>
          <div className="source-grid">
            <span>Target floor</span>
            <strong>{desiredFloor}</strong>
            <span>OSM buildings</span>
            <strong>
              {buildingDataMode === 'loading'
                ? '...'
                : buildingIsCapped
                  ? `${buildingFootprints.length}/${buildingTotalCount}`
                  : buildingFootprints.length}
            </strong>
            <span>Nearest</span>
            <strong>
              {selectedBuilding.building
                ? `${selectedBuilding.building.levels ?? '?'} fl.`
                : 'no data'}
            </strong>
            <span>Distance</span>
            <strong>
              {selectedBuilding.building ? formatMeters(selectedBuilding.distance) : 'no data'}
            </strong>
            <span>Match</span>
            <strong>{floorMatch === null ? 'no data' : floorMatch ? 'yes' : 'no'}</strong>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Scoring profile</span>
          </div>
          <div className="profile-grid">
            {EVALUATION_PROFILES.map((profile) => (
              <button
                className={`profile-button ${profile.id === activeProfileId ? 'active' : ''}`}
                key={profile.id}
                type="button"
                onClick={() => applyProfile(profile)}
              >
                {profile.label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Overlay</span>
            <Layers3 size={16} />
          </div>
          <div className="segmented-control">
            {(['suitability', 'risk', 'opportunity'] as LayerMode[]).map((mode) => (
              <button
                className={`segment-button ${layerMode === mode ? 'active' : ''}`}
                key={mode}
                type="button"
                onClick={() => setLayerMode(mode)}
              >
                {mode === 'suitability' ? 'Score' : mode === 'risk' ? 'Risk' : 'Potential'}
              </button>
            ))}
          </div>
          <label className="toggle-row">
            <input
              checked={showOverlay}
              type="checkbox"
              onChange={(event) => setShowOverlay(event.target.checked)}
            />
            <span>Show layer</span>
          </label>
          <label className="range-row">
            <span>Opacity</span>
            <input
              max="0.82"
              min="0.18"
              step="0.02"
              type="range"
              value={overlayOpacity}
              onChange={(event) => setOverlayOpacity(Number(event.target.value))}
            />
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Criteria</span>
            <button
              className="text-button"
              type="button"
              onClick={() => setShowPois((current) => !current)}
            >
              {showPois ? <EyeOff size={16} /> : <Eye size={16} />}
              {showPois ? 'Hide points' : 'Show points'}
            </button>
          </div>

          <div className="criteria-list">
            {criteria.map((criterion) => {
              const Icon =
                criterion.id === 'center'
                  ? Building2
                  : criterion.id === 'crime'
                    ? ShieldAlert
                    : criterion.id === 'registry'
                      ? UserRoundSearch
                    : CATEGORY_META[criterion.id].icon
              const pointCount =
                criterion.id === 'center'
                  ? 1
                  : criterion.id === 'crime'
                    ? crimeIncidents.length
                    : criterion.id === 'registry'
                      ? registryRiskPoints.length
                    : criterion.id === 'noise'
                      ? poisByCategory.noise.length +
                        suitabilityField.noiseSegmentCount +
                        suitabilityField.trafficSegmentCount +
                        suitabilityField.landPenaltyAreaCount
                      : poisByCategory[criterion.id].length

              return (
                <div className="criterion-row" key={criterion.id}>
                  <label className="criterion-head">
                    <input
                      checked={criterion.enabled}
                      type="checkbox"
                      onChange={(event) =>
                        updateCriterion(criterion.id, { enabled: event.target.checked })
                      }
                    />
                    <span className="criterion-icon">
                      <Icon size={16} />
                    </span>
                    <span>{criterion.label}</span>
                    <span className="criterion-count">{pointCount}</span>
                  </label>
                  <input
                    aria-label={`${criterion.label}: weight`}
                    disabled={!criterion.enabled}
                    max="100"
                    min="0"
                    type="range"
                    value={criterion.weight}
                    onChange={(event) =>
                      updateCriterion(criterion.id, { weight: Number(event.target.value) })
                    }
                  />
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Strong zones</span>
          </div>
          <div className="rank-list">
            {neighborhoodScores.slice(0, 6).map((item) => (
              <div className="rank-row" key={item.name}>
                <span className="rank-name">{item.name}</span>
                <span className="score-pill" style={{ backgroundColor: colorForScore(item.score) }}>
                  {Math.round(item.score * 100)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Growth zones</span>
            <Sparkles size={16} />
          </div>
          <div className="rank-list compact">
            {opportunityZones.slice(0, 5).map((item) => (
              <div className="rank-row" key={item.name}>
                <span className="rank-name">{item.name}</span>
                <span className="score-pair">
                  <span>{Math.round(item.analysis.opportunityScore * 100)} potential</span>
                  <strong>{Math.round(item.analysis.riskScore * 100)} risk</strong>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Sources</span>
          </div>
          <div className="source-grid">
            <span>OSM</span>
            <strong>{dataMode === 'live' ? pois.length : FALLBACK_POIS.length}</strong>
            <span>Crime</span>
            <strong>{crimeIncidents.length}</strong>
            <span>Registry</span>
            <strong>{registryRiskPoints.length}</strong>
            <span>Noise</span>
            <strong>{noiseSegments.length}</strong>
            <span>Traffic</span>
            <strong>{trafficSegments.length}</strong>
            <span>Land</span>
            <strong>{landPenaltyAreas.length}</strong>
            <span>Buildings</span>
            <strong>
              {buildingDataMode === 'loading'
                ? '...'
                : buildingIsCapped
                  ? `${buildingFootprints.length}/${buildingTotalCount}`
                  : buildingFootprints.length}
            </strong>
          </div>
          {buildingIsCapped ? (
            <p className="data-note">Buildings sample: {buildingFootprints.length} of {buildingTotalCount}.</p>
          ) : null}
        </section>

        <footer className="panel-footer">
          <div className="legend">
            <span>Critical</span>
            <div className="legend-ramp" />
            <span>Top</span>
          </div>
          <div className="legend-labels" aria-label="Suitability scale">
            {SCORE_BANDS.map((band) => (
              <span key={band.range}>
                <i style={{ backgroundColor: band.color }} />
                <strong>{band.range}</strong>
                {band.label}
              </span>
            ))}
          </div>
          {error ? <p className="data-note">Some live data is unavailable.</p> : null}
        </footer>
      </aside>

      <main className="map-stage">
        {mapTopBar}
        {overlayIsResolving ? (
          <div className="map-loading-pulse" aria-live="polite">
            <span />
            <strong>{loadingHeadline}</strong>
            <em>{loadProgress}%</em>
          </div>
        ) : null}
        <MapContainer
          attributionControl={false}
          bounds={[
            [activeCity.bounds.south, activeCity.bounds.west],
            [activeCity.bounds.north, activeCity.bounds.east],
          ]}
          className="housing-map"
          maxZoom={17}
          minZoom={11}
          scrollWheelZoom
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <AttributionControl position="bottomright" prefix={false} />
          <ZoomControl position="bottomright" />
          <MapViewportSync bounds={activeCity.bounds} />
          <MapLayoutResizeSync layoutKey={`${isLeftPanelOpen}-${isInspectorOpen}`} />
          <MapClickSelector disabled={isRegionSelectMode} onSelect={setSelectedPoint} />
          <MapRegionSelector
            active={isRegionSelectMode}
            draftBounds={draftRegionBounds}
            selectedBounds={selectedRegionBounds}
            onDraft={setDraftRegionBounds}
            onSelect={applyRegionBounds}
          />
          <SuitabilityCanvasOverlay
            field={suitabilityField}
            mode={layerMode}
            opacity={overlayOpacity}
            resolving={overlayIsResolving}
            visible={showOverlay}
          />

          <CircleMarker
            center={[selectedPoint.lat, selectedPoint.lng]}
            pathOptions={{
              color: '#15181f',
              fillColor: colorForScore(selectedAnalysis.score),
              fillOpacity: 0.95,
              opacity: 0.95,
              weight: 2,
            }}
            radius={9}
          />

          {showPois
            ? visiblePois.map((poi) => (
                <CircleMarker
                  center={[poi.lat, poi.lng]}
                  key={poi.id}
                  pathOptions={{
                    color: '#ffffff',
                    fillColor: CATEGORY_META[poi.category].color,
                    fillOpacity: 0.92,
                    opacity: 0.9,
                    weight: 1.5,
                  }}
                  radius={5}
                >
                  <Popup>
                    <div className="poi-popup">
                      <strong>{poi.name}</strong>
                      <span>{CATEGORY_META[poi.category].label}</span>
                    </div>
                  </Popup>
                </CircleMarker>
              ))
            : null}
        </MapContainer>
      </main>
      {pointInspector}
    </div>
  )
}

export default App

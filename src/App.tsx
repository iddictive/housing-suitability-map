import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet'
import {
  BarChart3,
  Building2,
  Download,
  Eye,
  EyeOff,
  Layers3,
  Loader2,
  MapPin,
  RefreshCcw,
  ShieldAlert,
  ShoppingBasket,
  Sparkles,
  Star,
  Target,
  TrainFront,
  TreePine,
  Volume2,
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './App.css'

type LatLng = {
  lat: number
  lng: number
}

type MapBounds = {
  south: number
  west: number
  north: number
  east: number
}

type CityConfig = {
  id: string
  state: string
  city: string
  bounds: MapBounds
  center: LatLng
  checkpoints: Array<LatLng & { name: string }>
}

type PoiCategory = 'parks' | 'groceries' | 'noise' | 'transit'
type CriterionId = PoiCategory | 'center' | 'crime'

type Poi = LatLng & {
  id: string
  name: string
  category: PoiCategory
  areaSqm?: number
  parkStrength?: number
  points?: LatLng[]
}

type CrimeIncident = LatLng & {
  id: string
  description: string
  category: string
}

type NoiseSourceKind = 'road' | 'rail' | 'airport'

type NoiseSegment = {
  id: string
  name: string
  kind: NoiseSourceKind
  points: LatLng[]
}

type LandPenaltyArea = {
  id: string
  name: string
  kind:
    | 'land'
    | 'residential'
    | 'water'
    | 'rail-yard'
    | 'airport'
    | 'industrial'
    | 'parking'
    | 'commercial'
    | 'civic'
    | 'cemetery'
  points: LatLng[]
  maxScore: number
  isLinear?: boolean
  bufferMeters?: number
}

type TrafficSegment = {
  id: string
  aadt: number
  year?: number
  points: LatLng[]
}

type BuildingFootprint = LatLng & {
  id: string
  name: string
  use: 'residential' | 'nonResidential' | 'unknown'
  levels: number | null
  heightMeters: number | null
  points?: LatLng[]
}

type DataMode = 'live' | 'sample'
type CrimeDataMode = 'live' | 'empty'
type BuildingDataMode = 'live' | 'empty' | 'loading'

type MainDataSnapshot = {
  pois: Poi[]
  crimeIncidents: CrimeIncident[]
  noiseSegments: NoiseSegment[]
  landPenaltyAreas: LandPenaltyArea[]
  trafficSegments: TrafficSegment[]
  dataMode: DataMode
  crimeDataMode: CrimeDataMode
}

type BuildingDataSnapshot = {
  buildingFootprints: BuildingFootprint[]
  buildingDataMode: Exclude<BuildingDataMode, 'loading'>
}

type Criterion = {
  id: CriterionId
  label: string
  enabled: boolean
  weight: number
  thresholdKm: number
  mode: 'nearIsGood' | 'farIsGood' | 'belowAverageIsGood'
}

type EvaluationProfile = {
  id: string
  label: string
  weights: Partial<Record<CriterionId, number>>
}

type FactorBreakdown = {
  id: CriterionId | 'land'
  label: string
  score: number
  detail: string
}

type PointAnalysis = {
  point: LatLng
  score: number
  label: string
  factors: FactorBreakdown[]
  bestFactor: FactorBreakdown
  worstFactor: FactorBreakdown
  riskScore: number
  opportunityScore: number
  confidence: number
  thesis: string
}

type SavedSite = PointAnalysis & {
  id: string
  name: string
}

type LayerMode = 'suitability' | 'risk' | 'opportunity'

type OverpassGeometryPoint = {
  lat: number
  lon: number
}

type OverpassMember = {
  type: string
  ref: number
  role?: string
  geometry?: OverpassGeometryPoint[]
}

type OverpassElement = {
  id: number
  type: string
  lat?: number
  lon?: number
  center?: {
    lat: number
    lon: number
  }
  tags?: Record<string, string>
  geometry?: OverpassGeometryPoint[]
  members?: OverpassMember[]
}

type CrimeRecord = {
  _id: number
  INCIDENT_NUMBER?: string
  OFFENSE_DESCRIPTION?: string
  UCR_PART?: string
  Lat?: string | number | null
  Long?: string | number | null
}

type TrafficRecord = {
  OBJECTID: number
  AADT?: number | null
  AADT_Year?: number | null
}

type ArcGisPolylineFeature = {
  attributes?: TrafficRecord
  geometry?: {
    paths?: number[][][]
  }
}

type SuitabilityField = {
  cellSizeMeters: number
  cols: number
  rows: number
  west: number
  north: number
  east: number
  south: number
  metersPerDegreeLng: number
  scores: Float32Array
  waterMaskByCell: Uint8Array
  noGoMaskByCell: Uint8Array
  overlayInclusionMaskByCell: Uint8Array
  overlayExclusionMaskByCell: Uint8Array
  residentialCandidateMaskByCell: Uint8Array
  overlayExclusionAreas: LatLng[][]
  noGoOverlayAreas: LatLng[][]
  averageScore: number
  averageCrimeDensity: number
  noiseSegmentCount: number
  trafficSegmentCount: number
  landPenaltyAreaCount: number
}

type SpatialFactorField = Omit<SuitabilityField, 'averageScore' | 'scores'> & {
  factorScores: Record<CriterionId, Float32Array>
  landScoreCapByCell: Float32Array
}

type ProjectedPoi = {
  x: number
  y: number
  areaSqm: number
  parkStrength: number
}

const BOSTON_BOUNDS = {
  south: 42.2279,
  west: -71.1912,
  north: 42.3976,
  east: -70.9234,
}

const BOSTON_CENTER: LatLng = {
  lat: 42.3555,
  lng: -71.0605,
}

const DEFAULT_CELL_SIZE_METERS = 100
const RESOLUTION_OPTIONS = [50, 100, 150, 200, 300] as const
const CRIME_RADIUS_METERS = 220
const API_CACHE_VERSION = 'housing-score-v11'
const API_CACHE_TTL_MS = 1000 * 60 * 60 * 12
const ZONE_SNAPSHOT_TTL_MS = 1000 * 60 * 10
const PARK_SCORE_FLOOR = 0.55
const MAJOR_ROAD_HARD_NOISE_METERS = 30
const MAJOR_ROAD_SOFT_NOISE_METERS = 180
const RAIL_HARD_NOISE_METERS = 45
const RAIL_SOFT_NOISE_METERS = 280
const AIRPORT_HARD_NOISE_METERS = 900
const AIRPORT_SOFT_NOISE_METERS = 4200
const TRAFFIC_MAX_AADT = 85_000
const BUILDING_MATCH_RADIUS_METERS = 90
const RESIDENTIAL_BUILDING_EVIDENCE_METERS = 95
const LAND_EVIDENCE_BUFFER_METERS = 125
const METERS_PER_DEGREE_LAT = 111_320
const CRIME_RESOURCE_ID = 'b973d8cb-eeb2-4e7e-99da-c92938efc9c0'
const MAX_CITY_LAT_SPAN = 0.12
const MAX_CITY_LNG_SPAN = 0.14

const CITY_OPTIONS: CityConfig[] = [
  {
    id: 'ma-boston',
    state: 'MA',
    city: 'Boston',
    bounds: BOSTON_BOUNDS,
    center: BOSTON_CENTER,
    checkpoints: [
      { name: 'Back Bay', lat: 42.3503, lng: -71.081 },
      { name: 'South End', lat: 42.3388, lng: -71.0738 },
      { name: 'Beacon Hill', lat: 42.3588, lng: -71.0707 },
      { name: 'Jamaica Plain', lat: 42.3097, lng: -71.1151 },
      { name: 'Brookline Village', lat: 42.3329, lng: -71.1185 },
      { name: 'Cambridgeport', lat: 42.3598, lng: -71.1076 },
      { name: 'Somerville', lat: 42.3876, lng: -71.0995 },
      { name: 'East Boston', lat: 42.3751, lng: -71.0392 },
      { name: 'Dorchester', lat: 42.3016, lng: -71.0676 },
      { name: 'Charlestown', lat: 42.3782, lng: -71.0602 },
    ],
  },
  {
    id: 'ma-cambridge',
    state: 'MA',
    city: 'Cambridge',
    bounds: { south: 42.3455, west: -71.1605, north: 42.4052, east: -71.0638 },
    center: { lat: 42.3736, lng: -71.1097 },
    checkpoints: [
      { name: 'Harvard Square', lat: 42.3734, lng: -71.1189 },
      { name: 'Central Square', lat: 42.3654, lng: -71.1038 },
      { name: 'Kendall Square', lat: 42.3626, lng: -71.0856 },
      { name: 'Porter Square', lat: 42.3884, lng: -71.1191 },
      { name: 'Cambridgeport', lat: 42.3598, lng: -71.1076 },
      { name: 'East Cambridge', lat: 42.3712, lng: -71.0829 },
    ],
  },
  {
    id: 'ma-somerville',
    state: 'MA',
    city: 'Somerville',
    bounds: { south: 42.372, west: -71.1352, north: 42.4147, east: -71.0705 },
    center: { lat: 42.3876, lng: -71.0995 },
    checkpoints: [
      { name: 'Davis Square', lat: 42.3967, lng: -71.1223 },
      { name: 'Union Square', lat: 42.3797, lng: -71.0954 },
      { name: 'Assembly', lat: 42.3927, lng: -71.0799 },
      { name: 'Winter Hill', lat: 42.3907, lng: -71.0912 },
      { name: 'Magoun Square', lat: 42.3934, lng: -71.1065 },
    ],
  },
  {
    id: 'ma-brookline',
    state: 'MA',
    city: 'Brookline',
    bounds: { south: 42.2958, west: -71.1578, north: 42.3548, east: -71.1064 },
    center: { lat: 42.3318, lng: -71.1212 },
    checkpoints: [
      { name: 'Brookline Village', lat: 42.3329, lng: -71.1185 },
      { name: 'Coolidge Corner', lat: 42.3424, lng: -71.1212 },
      { name: 'Washington Square', lat: 42.3391, lng: -71.1343 },
      { name: 'Brookline Hills', lat: 42.3316, lng: -71.1266 },
      { name: 'Chestnut Hill', lat: 42.3207, lng: -71.1571 },
    ],
  },
]

const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
] as const

const MAJOR_CITIES_BY_STATE: Record<string, string[]> = {
  AL: ['Birmingham', 'Huntsville', 'Montgomery', 'Mobile', 'Tuscaloosa'],
  AK: ['Anchorage', 'Fairbanks', 'Juneau', 'Wasilla'],
  AZ: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Tempe'],
  AR: ['Little Rock', 'Fayetteville', 'Fort Smith', 'Springdale', 'Jonesboro'],
  CA: ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Sacramento', 'Oakland', 'Irvine'],
  CO: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Boulder', 'Lakewood'],
  CT: ['Bridgeport', 'New Haven', 'Stamford', 'Hartford', 'Waterbury'],
  DE: ['Wilmington', 'Dover', 'Newark'],
  FL: ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Fort Lauderdale'],
  GA: ['Atlanta', 'Augusta', 'Savannah', 'Columbus', 'Athens'],
  HI: ['Honolulu', 'Hilo', 'Kailua', 'Kapolei'],
  ID: ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello'],
  IL: ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Evanston'],
  IN: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Bloomington'],
  IA: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City'],
  KS: ['Wichita', 'Overland Park', 'Kansas City', 'Olathe', 'Topeka'],
  KY: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro'],
  LA: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles'],
  ME: ['Portland', 'Lewiston', 'Bangor', 'South Portland'],
  MD: ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Annapolis'],
  MA: ['Boston', 'Cambridge', 'Somerville', 'Brookline', 'Worcester', 'Springfield', 'Lowell'],
  MI: ['Detroit', 'Grand Rapids', 'Ann Arbor', 'Lansing', 'Troy'],
  MN: ['Minneapolis', 'Saint Paul', 'Rochester', 'Duluth', 'Bloomington'],
  MS: ['Jackson', 'Gulfport', 'Southaven', 'Biloxi', 'Hattiesburg'],
  MO: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', 'Independence'],
  MT: ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Helena'],
  NE: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island'],
  NV: ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks'],
  NH: ['Manchester', 'Nashua', 'Concord', 'Dover', 'Portsmouth'],
  NJ: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Hoboken'],
  NM: ['Albuquerque', 'Las Cruces', 'Santa Fe', 'Rio Rancho'],
  NY: ['New York', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse', 'Albany'],
  NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Asheville'],
  ND: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton'],
  OK: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond'],
  OR: ['Portland', 'Eugene', 'Salem', 'Bend', 'Beaverton'],
  PA: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Harrisburg', 'Erie'],
  RI: ['Providence', 'Warwick', 'Cranston', 'Pawtucket'],
  SC: ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach', 'Spartanburg'],
  SD: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings'],
  TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Franklin'],
  TX: ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'Plano'],
  UT: ['Salt Lake City', 'West Valley City', 'Provo', 'Ogden', 'Sandy'],
  VT: ['Burlington', 'South Burlington', 'Rutland', 'Montpelier'],
  VA: ['Virginia Beach', 'Richmond', 'Arlington', 'Alexandria', 'Norfolk'],
  WA: ['Seattle', 'Spokane', 'Tacoma', 'Bellevue', 'Vancouver'],
  WV: ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg'],
  WI: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Appleton'],
  WY: ['Cheyenne', 'Casper', 'Laramie', 'Gillette'],
}

const INITIAL_CRITERIA: Criterion[] = [
  {
    id: 'parks',
    label: 'Парки',
    enabled: true,
    weight: 58,
    thresholdKm: 1.2,
    mode: 'nearIsGood',
  },
  {
    id: 'groceries',
    label: 'Магазины',
    enabled: true,
    weight: 86,
    thresholdKm: 1,
    mode: 'nearIsGood',
  },
  {
    id: 'noise',
    label: 'Шум',
    enabled: true,
    weight: 76,
    thresholdKm: 1.15,
    mode: 'farIsGood',
  },
  {
    id: 'transit',
    label: 'Транспорт',
    enabled: true,
    weight: 58,
    thresholdKm: 0.9,
    mode: 'nearIsGood',
  },
  {
    id: 'center',
    label: 'Центр',
    enabled: true,
    weight: 42,
    thresholdKm: 8,
    mode: 'nearIsGood',
  },
  {
    id: 'crime',
    label: 'Криминал',
    enabled: true,
    weight: 96,
    thresholdKm: 1,
    mode: 'belowAverageIsGood',
  },
]

const EVALUATION_PROFILES: EvaluationProfile[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    weights: { parks: 58, groceries: 86, noise: 76, transit: 58, center: 42, crime: 96 },
  },
  {
    id: 'quiet',
    label: 'Quiet premium',
    weights: { parks: 64, groceries: 64, noise: 100, transit: 38, center: 28, crime: 100 },
  },
  {
    id: 'carfree',
    label: 'Car-free',
    weights: { parks: 50, groceries: 92, noise: 70, transit: 96, center: 68, crime: 88 },
  },
  {
    id: 'family',
    label: 'Family',
    weights: { parks: 84, groceries: 86, noise: 90, transit: 48, center: 24, crime: 100 },
  },
  {
    id: 'investor',
    label: 'Investor',
    weights: { parks: 46, groceries: 78, noise: 72, transit: 86, center: 74, crime: 92 },
  },
]

const FALLBACK_POIS: Poi[] = [
  { id: 'park-common', name: 'Boston Common', category: 'parks', lat: 42.355, lng: -71.0656 },
  { id: 'park-esplanade', name: 'Charles River Esplanade', category: 'parks', lat: 42.3588, lng: -71.0786 },
  { id: 'park-emerald', name: 'Emerald Necklace', category: 'parks', lat: 42.3429, lng: -71.0972 },
  { id: 'park-jamaica', name: 'Jamaica Pond', category: 'parks', lat: 42.3162, lng: -71.1208 },
  { id: 'park-franklin', name: 'Franklin Park', category: 'parks', lat: 42.303, lng: -71.091 },
  { id: 'grocery-dtx', name: 'Downtown Crossing Market', category: 'groceries', lat: 42.3561, lng: -71.0597 },
  { id: 'grocery-backbay', name: 'Back Bay Market', category: 'groceries', lat: 42.3489, lng: -71.0831 },
  { id: 'grocery-cambridge', name: 'Central Square Market', category: 'groceries', lat: 42.3654, lng: -71.1038 },
  { id: 'grocery-southend', name: 'South End Market', category: 'groceries', lat: 42.3419, lng: -71.0717 },
  { id: 'grocery-jp', name: 'Jamaica Plain Market', category: 'groceries', lat: 42.3097, lng: -71.1151 },
  { id: 'noise-fenway', name: 'Fenway nightlife', category: 'noise', lat: 42.3467, lng: -71.0972 },
  { id: 'noise-seaport', name: 'Seaport nightlife', category: 'noise', lat: 42.3508, lng: -71.0432 },
  { id: 'noise-dtx', name: 'Downtown nightlife', category: 'noise', lat: 42.3554, lng: -71.0622 },
  { id: 'noise-cambridge', name: 'Central Square nightlife', category: 'noise', lat: 42.3655, lng: -71.1034 },
  { id: 'transit-park', name: 'Park Street', category: 'transit', lat: 42.3564, lng: -71.0624 },
  { id: 'transit-backbay', name: 'Back Bay', category: 'transit', lat: 42.3474, lng: -71.0757 },
  { id: 'transit-north', name: 'North Station', category: 'transit', lat: 42.3663, lng: -71.0622 },
  { id: 'transit-ruggles', name: 'Ruggles', category: 'transit', lat: 42.3364, lng: -71.0893 },
  { id: 'transit-south', name: 'South Station', category: 'transit', lat: 42.3523, lng: -71.0552 },
]

const CATEGORY_META: Record<
  PoiCategory,
  {
    label: string
    color: string
    icon: typeof TreePine
  }
> = {
  parks: { label: 'Парки', color: '#238b45', icon: TreePine },
  groceries: { label: 'Магазины', color: '#1d70b8', icon: ShoppingBasket },
  noise: { label: 'Шум', color: '#bd3b21', icon: Volume2 },
  transit: { label: 'Транспорт', color: '#635bff', icon: TrainFront },
}

const SCORE_BANDS = [
  { min: 0, max: 10, range: '0-10', label: 'Нежилая зона', color: '#d7191c', rgb: [215, 25, 28] },
  { min: 11, max: 20, range: '11-20', label: 'Пиздец', color: '#d7191c', rgb: [215, 25, 28] },
  { min: 21, max: 30, range: '21-30', label: 'Очень плохо', color: '#e85b20', rgb: [232, 91, 32] },
  { min: 31, max: 40, range: '31-40', label: 'Плохо', color: '#f07c24', rgb: [240, 124, 36] },
  { min: 41, max: 50, range: '41-50', label: 'Ниже среднего', color: '#f4b63f', rgb: [244, 182, 63] },
  { min: 51, max: 60, range: '51-60', label: 'Средне', color: '#f4d03f', rgb: [244, 208, 63] },
  { min: 61, max: 70, range: '61-70', label: 'Хорошо', color: '#32a852', rgb: [50, 168, 82] },
  { min: 71, max: 80, range: '71-80', label: 'Очень хорошо', color: '#1aa577', rgb: [26, 165, 119] },
  { min: 81, max: 90, range: '81-90', label: 'Отлично', color: '#1787e0', rgb: [23, 135, 224] },
  { min: 91, max: 100, range: '91-100', label: 'Топ', color: '#7b2ff7', rgb: [123, 47, 247] },
] as const

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const metersPerDegreeLngForBounds = (bounds: MapBounds) => {
  const referenceLat = (bounds.south + bounds.north) / 2

  return METERS_PER_DEGREE_LAT * Math.cos((referenceLat * Math.PI) / 180)
}

const latLngToMeters = (
  point: LatLng,
  bounds = BOSTON_BOUNDS,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
) => ({
  x: (point.lng - bounds.west) * metersPerDegreeLng,
  y: (bounds.north - point.lat) * METERS_PER_DEGREE_LAT,
})

const fieldBounds = (field: Pick<SuitabilityField, 'south' | 'west' | 'north' | 'east'>): MapBounds => ({
  south: field.south,
  west: field.west,
  north: field.north,
  east: field.east,
})

const approximatePolygonAreaSqm = (points: LatLng[], bounds = BOSTON_BOUNDS) => {
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

const parkStrengthFromArea = (areaSqm = 0) => {
  const edgeEquivalent = Math.sqrt(Math.max(0, areaSqm))

  return clamp((edgeEquivalent - 40) / 320, 0.05, 1)
}

const memoryApiCache = new Map<string, unknown>()

const apiCacheKey = (key: string) => `${API_CACHE_VERSION}:${key}`

const boundsCachePart = (bounds: MapBounds) =>
  `${bounds.south.toFixed(4)},${bounds.west.toFixed(4)},${bounds.north.toFixed(4)},${bounds.east.toFixed(4)}`

const readApiCache = <T,>(key: string): T | null => {
  const normalizedKey = apiCacheKey(key)

  if (memoryApiCache.has(normalizedKey)) {
    return memoryApiCache.get(normalizedKey) as T
  }

  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(normalizedKey)

    if (!raw) {
      return null
    }

    const cached = JSON.parse(raw) as { expiresAt: number; value: T }

    if (cached.expiresAt < Date.now()) {
      window.localStorage.removeItem(normalizedKey)
      return null
    }

    memoryApiCache.set(normalizedKey, cached.value)
    return cached.value
  } catch {
    return null
  }
}

const writeApiCache = <T,>(key: string, value: T, ttlMs = API_CACHE_TTL_MS) => {
  const normalizedKey = apiCacheKey(key)

  memoryApiCache.set(normalizedKey, value)

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      normalizedKey,
      JSON.stringify({
        expiresAt: Date.now() + ttlMs,
        value,
      }),
    )
  } catch {
    // Large city datasets may exceed localStorage. Memory cache still covers this session.
  }
}

const cachedRequest = async <T,>(
  key: string,
  request: () => Promise<T>,
  options: { force?: boolean } = {},
) => {
  const cached = options.force ? null : readApiCache<T>(key)

  if (cached) {
    return cached
  }

  const value = await request()

  writeApiCache(key, value)
  return value
}

const zoneSnapshotKey = (kind: 'main' | 'buildings', city: CityConfig) =>
  `zone-snapshot:${kind}:${city.id}:${boundsCachePart(city.bounds)}`

const readZoneSnapshot = <T,>(key: string) => readApiCache<T>(key)

const writeZoneSnapshot = <T,>(key: string, value: T) => {
  writeApiCache(key, value, ZONE_SNAPSHOT_TTL_MS)
}

const boundsToBbox = (bounds: MapBounds) =>
  `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`

const limitBoundsAroundCenter = (bounds: MapBounds, center: LatLng): MapBounds => {
  const latSpan = Math.min(bounds.north - bounds.south, MAX_CITY_LAT_SPAN)
  const lngSpan = Math.min(bounds.east - bounds.west, MAX_CITY_LNG_SPAN)

  return {
    south: center.lat - latSpan / 2,
    north: center.lat + latSpan / 2,
    west: center.lng - lngSpan / 2,
    east: center.lng + lngSpan / 2,
  }
}

const genericCityCheckpoints = (city: string, bounds: MapBounds, center: LatLng) => {
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

type NominatimPlace = {
  lat: string
  lon: string
  display_name: string
  boundingbox?: [string, string, string, string]
}

const fetchCityConfig = async (stateCode: string, cityName: string): Promise<CityConfig> => {
  const state = US_STATES.find((item) => item.code === stateCode)

  if (!state || cityName.trim().length === 0) {
    throw new Error('city required')
  }

  const searchParams = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'us',
    addressdetails: '1',
    q: `${cityName.trim()}, ${state.name}, USA`,
  })
  const cacheKey = `geocode:${stateCode}:${cityName.trim().toLowerCase()}`
  const places = await cachedRequest<NominatimPlace[]>(cacheKey, async () => {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams}`)

    if (!response.ok) {
      throw new Error(`Nominatim ${response.status}`)
    }

    return (await response.json()) as NominatimPlace[]
  })
  const place = places[0]

  if (!place) {
    throw new Error('city not found')
  }

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
    south: lat - 0.08,
    north: lat + 0.08,
    west: lng - 0.1,
    east: lng + 0.1,
  }
  const center = { lat, lng }
  const safeBounds = limitBoundsAroundCenter(
    Object.values(bounds).every(Number.isFinite) ? bounds : fallbackBounds,
    center,
  )
  const city = cityName.trim()

  return {
    id: `custom-${stateCode}-${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    state: stateCode,
    city,
    bounds: safeBounds,
    center,
    checkpoints: genericCityCheckpoints(city, safeBounds, center),
  }
}

const buildOverpassQuery = (bounds: MapBounds) => {
  const bbox = boundsToBbox(bounds)

  return `
[out:json][timeout:14];
(
  node["leisure"="park"](${bbox});
  way["leisure"="park"](${bbox});
  relation["leisure"="park"](${bbox});
  node["shop"~"^(supermarket|grocery|greengrocer)$"](${bbox});
  way["shop"~"^(supermarket|grocery|greengrocer)$"](${bbox});
  relation["shop"~"^(supermarket|grocery|greengrocer)$"](${bbox});
  node["amenity"~"^(bar|pub|nightclub|music_venue)$"](${bbox});
  way["amenity"~"^(bar|pub|nightclub|music_venue)$"](${bbox});
  node["leisure"="nightclub"](${bbox});
  way["leisure"="nightclub"](${bbox});
  node["public_transport"~"^(station|stop_position)$"](${bbox});
  node["railway"~"^(station|subway_entrance|tram_stop)$"](${bbox});
  way["railway"="station"](${bbox});
);
out center geom tags;`
}

const buildNoiseSegmentsQuery = (bounds: MapBounds) => {
  const bbox = boundsToBbox(bounds)

  return `
[out:json][timeout:14];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|unclassified|service)$"](${bbox});
  way["railway"~"^(rail|light_rail|subway)$"](${bbox});
  way["aeroway"~"^(runway|taxiway|apron|aerodrome)$"](${bbox});
  relation["aeroway"~"^(runway|taxiway|apron|aerodrome)$"](${bbox});
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
  way["railway"~"^(yard|station)$"](${bbox});
  relation["railway"~"^(yard|station)$"](${bbox});
  way["landuse"~"^(railway|industrial|commercial|retail|cemetery)$"](${bbox});
  relation["landuse"~"^(railway|industrial|commercial|retail|cemetery)$"](${bbox});
  way["landuse"~"^(residential|allotments|education|institutional|recreation_ground|village_green)$"](${bbox});
  relation["landuse"~"^(residential|allotments|education|institutional|recreation_ground|village_green)$"](${bbox});
  way["place"~"^(island|islet)$"](${bbox});
  relation["place"~"^(island|islet)$"](${bbox});
  way["amenity"="parking"](${bbox});
  relation["amenity"="parking"](${bbox});
  way["amenity"~"^(school|university|college|hospital|grave_yard)$"](${bbox});
  relation["amenity"~"^(school|university|college|hospital|grave_yard)$"](${bbox});
);
out geom tags;`
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

const categoryFromTags = (tags: Record<string, string> = {}): PoiCategory | null => {
  if (tags.leisure === 'park') {
    return 'parks'
  }

  if (['supermarket', 'grocery', 'greengrocer'].includes(tags.shop ?? '')) {
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
  const polygonRings = category === 'parks' ? ringsFromOverpassElement(element) : []
  const areaSqm =
    category === 'parks'
      ? polygonRings.reduce((total, points) => total + approximatePolygonAreaSqm(points, bounds), 0)
      : 0

  if (!category || lat === undefined || lng === undefined) {
    return null
  }

  return {
    id: `${element.type}-${element.id}`,
    category,
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

    const normalizedRing = normalizeRing(ring)

    if (normalizedRing.length >= 3) {
      rings.push(normalizedRing)
    }
  }

  return rings
}

const ringsFromOverpassElement = (element: OverpassElement) => {
  if (
    element.geometry &&
    element.geometry.length >= 4 &&
    sameLatLng(overpassPointToLatLng(element.geometry[0]), overpassPointToLatLng(element.geometry[element.geometry.length - 1]))
  ) {
    return [normalizeRing(element.geometry.map(overpassPointToLatLng))]
  }

  const memberSegments =
    element.members
      ?.filter((member) => member.role !== 'inner' && member.geometry && member.geometry.length >= 2)
      .map((member) => member.geometry?.map(overpassPointToLatLng) ?? []) ?? []

  return stitchRings(memberSegments)
}

const landPenaltyTemplateFromTags = (
  tags: Record<string, string>,
): Pick<LandPenaltyArea, 'kind' | 'maxScore'> | null => {
  const isWater =
    tags.natural === 'water' ||
    tags.natural === 'bay' ||
    tags.natural === 'strait' ||
    tags.place === 'sea' ||
    tags.place === 'ocean' ||
    tags.water !== undefined ||
    tags.waterway === 'river' ||
    tags.waterway === 'riverbank' ||
    tags.waterway === 'dock' ||
    tags.waterway === 'canal' ||
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

  if (tags.landuse === 'commercial' || tags.landuse === 'retail') {
    return {
      kind: 'commercial',
      maxScore: 0.42,
    }
  }

  if (['school', 'university', 'college', 'hospital'].includes(tags.amenity ?? '')) {
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

  if (
    tags.highway ||
    ['allotments', 'education', 'institutional', 'recreation_ground', 'village_green'].includes(tags.landuse ?? '') ||
    ['island', 'islet'].includes(tags.place ?? '')
  ) {
    return {
      kind: 'land',
      maxScore: 1,
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
  const isLinearLandEvidence =
    template.kind === 'land' &&
    tags.highway !== undefined &&
    geometryPoints.length >= 2 &&
    !sameLatLng(geometryPoints[0], geometryPoints[geometryPoints.length - 1])

  if (isLinearLandEvidence) {
    return [
      {
        id: `${element.type}-${element.id}-land-line`,
        name: tags.name ?? tags.highway ?? template.kind,
        kind: 'land',
        points: geometryPoints,
        maxScore: 1,
        isLinear: true,
        bufferMeters: LAND_EVIDENCE_BUFFER_METERS,
      },
    ]
  }

  return ringsFromOverpassElement(element).map((points, index) => ({
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
    points,
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
    async () => {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: buildOverpassQuery(bounds),
        signal,
      })

      if (!response.ok) {
        throw new Error(`Overpass ${response.status}`)
      }

      return (await response.json()) as { elements?: OverpassElement[] }
    },
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
  const payload = await cachedRequest<{ elements?: OverpassElement[] }>(
    `masks-noise:${boundsCachePart(bounds)}`,
    async () => {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: buildNoiseSegmentsQuery(bounds),
        signal,
      })

      if (!response.ok) {
        throw new Error(`Overpass noise ${response.status}`)
      }

      return (await response.json()) as { elements?: OverpassElement[] }
    },
    { force },
  )

  const elements = payload.elements ?? []

  return {
    segments: elements
      .map(elementToNoiseSegment)
      .filter((segment): segment is NoiseSegment => Boolean(segment)),
    areas: elements.flatMap(elementToLandPenaltyAreas),
  }
}

const fetchBuildingFootprints = async (signal: AbortSignal, bounds: MapBounds, force = false) => {
  const payload = await cachedRequest<{ elements?: OverpassElement[] }>(
    `building-levels:${boundsCachePart(bounds)}`,
    async () => {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: buildBuildingLevelsQuery(bounds),
        signal,
      })

      if (!response.ok) {
        throw new Error(`Overpass buildings ${response.status}`)
      }

      return (await response.json()) as { elements?: OverpassElement[] }
    },
    { force },
  )

  return (payload.elements ?? [])
    .map(elementToBuildingFootprint)
    .filter((building): building is BuildingFootprint => Boolean(building))
    .slice(0, 75_000)
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
  const url = new URL('/api/boston-crime/api/3/action/datastore_search_sql', window.location.origin)

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
    const url = new URL(
      '/api/massdot/arcgis/rest/services/Roads/RoadInventoryLRS/FeatureServer/56/query',
      window.location.origin,
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

const scoreByDistance = (distance: number, criterion: Criterion) => {
  if (!Number.isFinite(distance)) {
    return 0.5
  }

  const normalized = clamp(distance / criterion.thresholdKm)

  return criterion.mode === 'nearIsGood' ? 1 - normalized : normalized
}

const nearestMeters = (
  x: number,
  y: number,
  points: Array<{
    x: number
    y: number
  }>,
) => {
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

const projectPoi = (
  poi: Poi,
  bounds = BOSTON_BOUNDS,
  metersPerDegreeLng = metersPerDegreeLngForBounds(bounds),
): ProjectedPoi => ({
  ...latLngToMeters(poi, bounds, metersPerDegreeLng),
  areaSqm: poi.areaSqm ?? 0,
  parkStrength: poi.parkStrength ?? parkStrengthFromArea(poi.areaSqm),
})

const parkInfluenceScore = (x: number, y: number, parks: ProjectedPoi[], criterion: Criterion) => {
  if (parks.length === 0) {
    return PARK_SCORE_FLOOR
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

  return PARK_SCORE_FLOOR + bestScore * (1 - PARK_SCORE_FLOOR)
}

const pointToSegmentDistanceMeters = (
  x: number,
  y: number,
  start: {
    x: number
    y: number
  },
  end: {
    x: number
    y: number
  },
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

const pointInPolygon = (
  x: number,
  y: number,
  polygon: Array<{
    x: number
    y: number
  }>,
) => {
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
  noiseSegments: NoiseSegment[],
  landPenaltyAreas: LandPenaltyArea[],
  trafficSegments: TrafficSegment[],
  bounds: MapBounds,
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
  const crimeBins = new Uint16Array(cellCount)
  const crimeDensity = new Float32Array(cellCount)
  const transportNoiseByCell = new Float32Array(cellCount)
  const landScoreCapByCell = new Float32Array(cellCount)
  const waterMaskByCell = new Uint8Array(cellCount)
  const noGoMaskByCell = new Uint8Array(cellCount)
  const overlayInclusionMaskByCell = new Uint8Array(cellCount)
  const overlayExclusionMaskByCell = new Uint8Array(cellCount)
  const residentialCandidateMaskByCell = new Uint8Array(cellCount)
  const factorScores = {
    parks: new Float32Array(cellCount),
    groceries: new Float32Array(cellCount),
    noise: new Float32Array(cellCount),
    transit: new Float32Array(cellCount),
    center: new Float32Array(cellCount),
    crime: new Float32Array(cellCount),
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
  }))
  const overlayExclusionAreas = [
    ...landPenaltyAreas
      .filter((area) => area.kind === 'water' && area.points.length >= 3)
      .map((area) => area.points),
    ...poisByCategory.parks
      .filter((park) => park.points && park.points.length >= 3)
      .map((park) => park.points ?? []),
  ]
  const noGoOverlayAreas = landPenaltyAreas
    .filter((area) => area.kind !== 'water' && area.maxScore <= 0 && area.points.length >= 3)
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

  for (const incident of crimeIncidents) {
    const point = project(incident)
    const column = Math.floor(point.x / cellSizeMeters)
    const row = Math.floor(point.y / cellSizeMeters)

    if (column >= 0 && column < cols && row >= 0 && row < rows) {
      crimeBins[row * cols + column] += 1
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
          const score = transportNoiseScore(
            pointToSegmentDistanceMeters(x, y, start, end),
            segment.kind,
          )
          const index = row * cols + column

          if (score < transportNoiseByCell[index]) {
            transportNoiseByCell[index] = score
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
          const score = trafficNoiseScore(pointToSegmentDistanceMeters(x, y, start, end), segment.aadt)
          const index = row * cols + column

          if (score < transportNoiseByCell[index]) {
            transportNoiseByCell[index] = score
          }
        }
      }
    }
  }

  for (const area of projectedLandPenaltyAreas) {
    const minX = Math.min(...area.points.map((point) => point.x))
    const maxX = Math.max(...area.points.map((point) => point.x))
    const minY = Math.min(...area.points.map((point) => point.y))
    const maxY = Math.max(...area.points.map((point) => point.y))
    const areaBuffer = area.isLinear ? (area.bufferMeters ?? 0) : 0
    const minColumn = Math.max(0, Math.floor((minX - areaBuffer) / cellSizeMeters))
    const maxColumn = Math.min(cols - 1, Math.floor((maxX + areaBuffer) / cellSizeMeters))
    const minRow = Math.max(0, Math.floor((minY - areaBuffer) / cellSizeMeters))
    const maxRow = Math.min(rows - 1, Math.floor((maxY + areaBuffer) / cellSizeMeters))

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = column * cellSizeMeters + cellSizeMeters / 2
        const y = row * cellSizeMeters + cellSizeMeters / 2

        let isInsideArea = pointInPolygon(x, y, area.points)

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
        } else {
          overlayInclusionMaskByCell[index] = 1

          if (area.kind === 'residential') {
            residentialCandidateMaskByCell[index] = 1
          }

          if (area.maxScore <= 0) {
            noGoMaskByCell[index] = 1
          }
        }

        if (area.maxScore < landScoreCapByCell[index]) {
          landScoreCapByCell[index] = area.maxScore
        }
      }
    }
  }

  for (const parkArea of projectedParkAreas) {
    const minX = Math.min(...parkArea.map((point) => point.x))
    const maxX = Math.max(...parkArea.map((point) => point.x))
    const minY = Math.min(...parkArea.map((point) => point.y))
    const maxY = Math.max(...parkArea.map((point) => point.y))
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

      factorScores.crime[index] = clamp(1 - crimeDensity[index] / (baseline * 3.1))
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
      factorScores.groceries[index] = scoreByDistance(
        nearestMeters(x, y, projectedPois.groceries) / 1000,
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
    noGoMaskByCell,
    overlayInclusionMaskByCell,
    overlayExclusionMaskByCell,
    residentialCandidateMaskByCell,
    overlayExclusionAreas,
    noGoOverlayAreas,
    averageCrimeDensity,
    noiseSegmentCount: noiseSegments.length,
    trafficSegmentCount: trafficSegments.length,
    landPenaltyAreaCount: landPenaltyAreas.length,
  }
}

const mixSuitabilityField = (
  criteria: Criterion[],
  spatialField: SpatialFactorField,
  buildingFootprints: BuildingFootprint[],
): SuitabilityField => {
  const cellCount = spatialField.cols * spatialField.rows
  const rawScores = new Float32Array(cellCount)
  const scores = new Float32Array(cellCount)
  const residentialCandidateMaskByCell = new Uint8Array(spatialField.residentialCandidateMaskByCell)
  const enabledCriteria = criteria.filter((criterion) => criterion.enabled && criterion.weight > 0)
  const totalWeight = enabledCriteria.reduce((total, criterion) => total + criterion.weight, 0)
  const habitableRawScores: number[] = []
  let scoreTotal = 0
  let habitableCellCount = 0
  const bounds = fieldBounds(spatialField)

  for (const building of buildingFootprints) {
    if (building.use !== 'residential') {
      continue
    }

    const point = latLngToMeters(building, bounds, spatialField.metersPerDegreeLng)
    const radiusCells = Math.max(1, Math.ceil(RESIDENTIAL_BUILDING_EVIDENCE_METERS / spatialField.cellSizeMeters))
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
          residentialCandidateMaskByCell[row * spatialField.cols + column] = 1
        }
      }
    }
  }

  let residentialCandidateCellCount = 0

  for (let index = 0; index < cellCount; index += 1) {
    if (residentialCandidateMaskByCell[index]) {
      residentialCandidateCellCount += 1
    }
  }

  const residentialEvidenceThreshold = Math.max(24, Math.floor(cellCount * 0.008))
  const hasResidentialEvidence = residentialCandidateCellCount >= residentialEvidenceThreshold

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

    if (
      spatialField.landScoreCapByCell[index] > 0 &&
      Boolean(spatialField.overlayInclusionMaskByCell[index]) &&
      (!hasResidentialEvidence || Boolean(residentialCandidateMaskByCell[index])) &&
      !spatialField.overlayExclusionMaskByCell[index] &&
      !spatialField.noGoMaskByCell[index]
    ) {
      habitableRawScores.push(cappedScore)
      habitableCellCount += 1
    }
  }

  const minHabitableScore = Math.min(...habitableRawScores)
  const maxHabitableScore = Math.max(...habitableRawScores)
  const scoreRange = maxHabitableScore - minHabitableScore

  for (let index = 0; index < cellCount; index += 1) {
    const isHabitable =
      spatialField.landScoreCapByCell[index] > 0 &&
      Boolean(spatialField.overlayInclusionMaskByCell[index]) &&
      (!hasResidentialEvidence || Boolean(residentialCandidateMaskByCell[index])) &&
      !spatialField.overlayExclusionMaskByCell[index] &&
      !spatialField.noGoMaskByCell[index]
    const normalizedScore =
      isHabitable && Number.isFinite(scoreRange) && scoreRange > 0.001
        ? clamp((rawScores[index] - minHabitableScore) / scoreRange)
        : rawScores[index]

    scores[index] = isHabitable
      ? normalizedScore
      : hasResidentialEvidence
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
    noGoMaskByCell: spatialField.noGoMaskByCell,
    overlayInclusionMaskByCell: spatialField.overlayInclusionMaskByCell,
    overlayExclusionMaskByCell: spatialField.overlayExclusionMaskByCell,
    residentialCandidateMaskByCell,
    overlayExclusionAreas: spatialField.overlayExclusionAreas,
    noGoOverlayAreas: spatialField.noGoOverlayAreas,
    averageScore: scoreTotal / Math.max(1, habitableCellCount),
    averageCrimeDensity: spatialField.averageCrimeDensity,
    noiseSegmentCount: spatialField.noiseSegmentCount,
    trafficSegmentCount: spatialField.trafficSegmentCount,
    landPenaltyAreaCount: spatialField.landPenaltyAreaCount,
  }
}

const scoreAt = (field: SuitabilityField, point: LatLng) => {
  const meters = latLngToMeters(point, fieldBounds(field), field.metersPerDegreeLng)
  const column = clamp(Math.floor(meters.x / field.cellSizeMeters), 0, field.cols - 1)
  const row = clamp(Math.floor(meters.y / field.cellSizeMeters), 0, field.rows - 1)

  return field.scores[row * field.cols + column]
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

const labelForScore = (score: number) => {
  const normalizedScore = Math.round(clamp(score) * 100)
  const band = SCORE_BANDS.find(
    (scoreBand) => normalizedScore >= scoreBand.min && normalizedScore <= scoreBand.max,
  )

  return band?.label ?? SCORE_BANDS[SCORE_BANDS.length - 1].label
}

const formatMeters = (meters: number) => {
  if (!Number.isFinite(meters)) {
    return 'нет данных'
  }

  return meters < 1000 ? `${Math.round(meters)} м` : `${(meters / 1000).toFixed(1)} км`
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

  for (const area of areas) {
    const points = area.points.map((point) => latLngToMeters(point, bounds, metersPerDegreeLng))

    if (pointInPolygon(x, y, points) && area.maxScore < cap) {
      cap = area.maxScore
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
  noiseSegments: NoiseSegment[],
  landPenaltyAreas: LandPenaltyArea[],
  trafficSegments: TrafficSegment[],
  dataCoverage: number,
): PointAnalysis => {
  const bounds = fieldBounds(field)
  const meters = latLngToMeters(point, bounds, field.metersPerDegreeLng)
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
  const groceryScore = scoreByDistance(nearestGrocery.distance / 1000, criteriaById.groceries)
  const nightlifeScore = scoreByDistance(nearestNightlife.distance / 1000, criteriaById.noise)
  const transportScore = Number.isFinite(nearestTransport)
    ? clamp(0.38 + Math.pow(clamp(nearestTransport / 520), 0.7) * 0.62)
    : 1
  const noiseScore = Math.min(nightlifeScore, transportScore)
  const transitScore = scoreByDistance(nearestTransit.distance / 1000, criteriaById.transit)
  const cityCenter = latLngToMeters(city.center, bounds, field.metersPerDegreeLng)
  const centerScore = scoreByDistance(
    Math.hypot(meters.x - cityCenter.x, meters.y - cityCenter.y) / 1000,
    criteriaById.center,
  )
  const crimeScore = crimeScoreAtPoint(point, crimeIncidents, field.averageCrimeDensity, bounds, field.metersPerDegreeLng)
  const landCap = landCapAtPoint(meters.x, meters.y, landPenaltyAreas, bounds, field.metersPerDegreeLng)
  const landFactorScore = landCap < 1 ? landCap : 0.86
  const factors: FactorBreakdown[] = [
    {
      id: 'parks',
      label: 'Парки',
      score: parkScore,
      detail: `${nearestPark.poi?.name ?? 'Парк'} · ${formatMeters(nearestPark.distance)}`,
    },
    {
      id: 'groceries',
      label: 'Магазины',
      score: groceryScore,
      detail: `${nearestGrocery.poi?.name ?? 'Магазин'} · ${formatMeters(nearestGrocery.distance)}`,
    },
    {
      id: 'noise',
      label: 'Шум',
      score: noiseScore,
      detail: `транспорт ${formatMeters(nearestTransport)}, nightlife ${formatMeters(nearestNightlife.distance)}`,
    },
    {
      id: 'transit',
      label: 'Транспорт',
      score: transitScore,
      detail: `${nearestTransit.poi?.name ?? 'Станция'} · ${formatMeters(nearestTransit.distance)}`,
    },
    {
      id: 'center',
      label: 'Центр',
      score: centerScore,
      detail: `${formatMeters(Math.hypot(meters.x - cityCenter.x, meters.y - cityCenter.y))}`,
    },
    {
      id: 'crime',
      label: 'Криминал',
      score: crimeScore,
      detail: crimeScore >= 0.65 ? 'ниже среднего фона' : crimeScore >= 0.4 ? 'около среднего' : 'выше среднего',
    },
    {
      id: 'land',
      label: 'Земля',
      score: landFactorScore,
      detail: landCap === 0 ? 'вода/не жилье' : landCap < 1 ? 'OSM cap: не жилая зона' : 'OSM cap не найден',
    },
  ]
  const sortedFactors = [...factors].sort((a, b) => a.score - b.score)
  const worstFactor = sortedFactors[0]
  const bestFactor = sortedFactors[sortedFactors.length - 1]
  const riskScore = 1 - Math.min(noiseScore, crimeScore, landCap)
  const opportunityScore = clamp(score * 0.72 + transitScore * 0.14 + groceryScore * 0.14 - riskScore * 0.18)
  const confidence = clamp(dataCoverage * 0.72 + (landCap < 1 ? 0.08 : 0.16) + (crimeIncidents.length > 0 ? 0.12 : 0))
  const thesis =
    score >= 0.62 && riskScore < 0.45
      ? 'Кандидат для shortlist: сильная пригодность без критического риска.'
      : riskScore >= 0.65
        ? 'Требует осторожности: риск/шум доминирует над удобствами.'
        : 'Пограничная зона: нужна проверка на уровне объекта и улицы.'

  return {
    point,
    score,
    label: labelForScore(score),
    factors,
    bestFactor,
    worstFactor,
    riskScore,
    opportunityScore,
    confidence,
    thesis,
  }
}

const SuitabilityCanvasOverlay = ({
  field,
  mode,
  opacity,
  visible,
}: {
  field: SuitabilityField
  mode: LayerMode
  opacity: number
  visible: boolean
}) => {
  const map = useMap()

  useEffect(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const pane = map.getPanes().overlayPane

    if (!context) {
      return undefined
    }

    canvas.className = 'suitability-canvas'
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
        const baseScore = field.scores[fieldIndex]
        const index = fieldIndex * 4

        if (
          !field.overlayInclusionMaskByCell[fieldIndex] ||
          field.overlayExclusionMaskByCell[fieldIndex] ||
          field.noGoMaskByCell[fieldIndex]
        ) {
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
    let canvasWidth = 0
    let canvasHeight = 0

    const draw = () => {
      const size = map.getSize()
      const deviceScale = window.devicePixelRatio || 1
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

      canvas.style.transform = `translate3d(${topLeft.x}px, ${topLeft.y}px, 0)`
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0)
      context.clearRect(0, 0, size.x, size.y)

      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.globalCompositeOperation = 'source-over'
      context.drawImage(offscreen, drawX, drawY, drawWidth, drawHeight)

      context.globalCompositeOperation = 'soft-light'
      context.fillStyle = 'rgba(255, 255, 255, 0.12)'
      context.fillRect(0, 0, size.x, size.y)
      context.globalCompositeOperation = 'source-over'
      eraseOverlayExclusions()
      drawNoGoOverlays()
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

    const eraseOverlayExclusions = () => {
      if (field.overlayExclusionAreas.length === 0) {
        return
      }

      context.save()
      context.globalCompositeOperation = 'destination-out'
      context.fillStyle = 'rgba(0, 0, 0, 1)'

      for (const area of field.overlayExclusionAreas) {
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

    const drawNoGoOverlays = () => {
      if (!visible || field.noGoOverlayAreas.length === 0) {
        return
      }

      context.save()
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = `rgba(215, 25, 28, ${Math.min(0.86, opacity * 0.92)})`

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
    map.on('move zoom resize viewreset moveend zoomend', scheduleDraw)

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }

      map.off('move zoom resize viewreset moveend zoomend', scheduleDraw)
      canvas.remove()
    }
  }, [field, map, mode, opacity, visible])

  return null
}

const MapClickSelector = ({
  onSelect,
}: {
  onSelect: (point: LatLng) => void
}) => {
  useMapEvents({
    click(event) {
      onSelect({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      })
    },
  })

  return null
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

const App = () => {
  const [selectedState, setSelectedState] = useState('MA')
  const [selectedCityId, setSelectedCityId] = useState('ma-boston')
  const [customCity, setCustomCity] = useState<CityConfig | null>(null)
  const [citySearchText, setCitySearchText] = useState('Boston')
  const [isSearchingCity, setIsSearchingCity] = useState(false)
  const [cellSizeMeters, setCellSizeMeters] = useState<number>(DEFAULT_CELL_SIZE_METERS)
  const [appliedCellSizeMeters, setAppliedCellSizeMeters] =
    useState<number>(DEFAULT_CELL_SIZE_METERS)
  const [criteria, setCriteria] = useState(INITIAL_CRITERIA)
  const [pois, setPois] = useState<Poi[]>(FALLBACK_POIS)
  const [crimeIncidents, setCrimeIncidents] = useState<CrimeIncident[]>([])
  const [noiseSegments, setNoiseSegments] = useState<NoiseSegment[]>([])
  const [landPenaltyAreas, setLandPenaltyAreas] = useState<LandPenaltyArea[]>([])
  const [trafficSegments, setTrafficSegments] = useState<TrafficSegment[]>([])
  const [buildingFootprints, setBuildingFootprints] = useState<BuildingFootprint[]>([])
  const [buildingDataMode, setBuildingDataMode] = useState<BuildingDataMode>('empty')
  const [desiredFloor, setDesiredFloor] = useState(8)
  const [isLoading, setIsLoading] = useState(true)
  const [dataMode, setDataMode] = useState<DataMode>('sample')
  const [crimeDataMode, setCrimeDataMode] = useState<CrimeDataMode>('empty')
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
  const deferredCellSizeMeters = useDeferredValue(appliedCellSizeMeters)

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
  const activeZoneCacheKey = useMemo(
    () => `${activeCity.id}:${boundsCachePart(activeCity.bounds)}`,
    [activeCity],
  )
  const suggestedCityNames = useMemo(() => {
    const cityNames = new Set([
      ...(MAJOR_CITIES_BY_STATE[selectedState] ?? []),
      ...availableCities.map((city) => city.city),
    ])

    return [...cityNames].sort((a, b) => a.localeCompare(b))
  }, [availableCities, selectedState])

  useEffect(() => {
    const controller = new AbortController()
    const forceRefresh = forceRefreshZoneKey === activeZoneCacheKey
    const mainSnapshotKey = zoneSnapshotKey('main', activeCity)

    Promise.resolve().then(() => {
      if (controller.signal.aborted) {
        return
      }

      if (!forceRefresh) {
        const snapshot = readZoneSnapshot<MainDataSnapshot>(mainSnapshotKey)

        if (snapshot) {
          setPois(snapshot.pois)
          setCrimeIncidents(snapshot.crimeIncidents)
          setNoiseSegments(snapshot.noiseSegments)
          setLandPenaltyAreas(snapshot.landPenaltyAreas)
          setTrafficSegments(snapshot.trafficSegments)
          setDataMode(snapshot.dataMode)
          setCrimeDataMode(snapshot.crimeDataMode)
          setError(null)
          setIsLoading(false)
          return
        }
      }

      setIsLoading(true)
    })

    Promise.allSettled([
      fetchPois(controller.signal, activeCity.bounds, forceRefresh),
      activeCity.id === 'ma-boston'
        ? fetchCrimeIncidents(controller.signal, activeCity.bounds, forceRefresh)
        : Promise.resolve([]),
      fetchNoiseSegments(controller.signal, activeCity.bounds, forceRefresh),
      activeCity.state === 'MA'
        ? fetchTrafficSegments(controller.signal, activeCity.bounds, forceRefresh)
        : Promise.resolve([]),
    ])
      .then(([poiResult, crimeResult, noiseResult, trafficResult]) => {
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
        const nextNoiseSegments =
          noiseResult.status === 'fulfilled' ? noiseResult.value.segments : []
        const nextLandPenaltyAreas =
          noiseResult.status === 'fulfilled' ? noiseResult.value.areas : []
        const nextTrafficSegments = trafficResult.status === 'fulfilled' ? trafficResult.value : []

        if (poiResult.status === 'fulfilled' && poiResult.value.length > 0) {
          setPois(nextPois)
          setDataMode(nextDataMode)
        } else {
          setPois(nextPois)
          setDataMode(nextDataMode)
          errors.push('OSM')
        }

        if (crimeResult.status === 'fulfilled') {
          setCrimeIncidents(nextCrimeIncidents)
          setCrimeDataMode(nextCrimeDataMode)
        } else {
          setCrimeIncidents(nextCrimeIncidents)
          setCrimeDataMode(nextCrimeDataMode)
          errors.push('crime')
        }

        if (noiseResult.status === 'fulfilled') {
          setNoiseSegments(nextNoiseSegments)
          setLandPenaltyAreas(nextLandPenaltyAreas)
        } else {
          setNoiseSegments(nextNoiseSegments)
          setLandPenaltyAreas(nextLandPenaltyAreas)
          errors.push('noise')
        }

        if (trafficResult.status === 'fulfilled') {
          setTrafficSegments(nextTrafficSegments)
        } else {
          setTrafficSegments(nextTrafficSegments)
          errors.push('traffic')
        }

        const hasFreshSource =
          poiResult.status === 'fulfilled' ||
          noiseResult.status === 'fulfilled' ||
          (activeCity.id === 'ma-boston' && crimeResult.status === 'fulfilled') ||
          (activeCity.state === 'MA' && trafficResult.status === 'fulfilled')

        if (hasFreshSource) {
          writeZoneSnapshot<MainDataSnapshot>(mainSnapshotKey, {
            pois: nextPois,
            crimeIncidents: nextCrimeIncidents,
            noiseSegments: nextNoiseSegments,
            landPenaltyAreas: nextLandPenaltyAreas,
            trafficSegments: nextTrafficSegments,
            dataMode: nextDataMode,
            crimeDataMode: nextCrimeDataMode,
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
  }, [activeCity, activeZoneCacheKey, forceRefreshZoneKey, refreshToken])

  useEffect(() => {
    const controller = new AbortController()
    let isCurrent = true
    const forceRefresh = forceRefreshZoneKey === activeZoneCacheKey
    const buildingSnapshotKey = zoneSnapshotKey('buildings', activeCity)

    Promise.resolve()
      .then(() => {
        if (!isCurrent) {
          return []
        }

        if (!forceRefresh) {
          const snapshot = readZoneSnapshot<BuildingDataSnapshot>(buildingSnapshotKey)

          if (snapshot) {
            setBuildingFootprints(snapshot.buildingFootprints)
            setBuildingDataMode(snapshot.buildingDataMode)
          } else {
            setBuildingFootprints([])
            setBuildingDataMode('loading')
          }
        } else {
          setBuildingFootprints([])
          setBuildingDataMode('loading')
        }

        return fetchBuildingFootprints(controller.signal, activeCity.bounds, forceRefresh)
      })
      .then((buildings) => {
        if (controller.signal.aborted || !isCurrent) {
          return
        }

        setBuildingFootprints(buildings)
        setBuildingDataMode(buildings.length > 0 ? 'live' : 'empty')
        writeZoneSnapshot<BuildingDataSnapshot>(buildingSnapshotKey, {
          buildingFootprints: buildings,
          buildingDataMode: buildings.length > 0 ? 'live' : 'empty',
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
          setBuildingFootprints(snapshot.buildingFootprints)
          setBuildingDataMode(snapshot.buildingDataMode)
        } else {
          setBuildingFootprints([])
          setBuildingDataMode('empty')
        }
      })

    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [activeCity, activeZoneCacheKey, forceRefreshZoneKey, refreshToken])

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
        setCustomCity(city)
        setSelectedCityId(city.id)
        setSelectedPoint(city.center)
        setSavedSites([])
        setCellSizeMeters(DEFAULT_CELL_SIZE_METERS)
        setAppliedCellSizeMeters(DEFAULT_CELL_SIZE_METERS)
      })
      .catch(() => {
        setError('Город не найден')
      })
      .finally(() => {
        setIsSearchingCity(false)
      })
  }, [citySearchText, selectedState])

  const poisByCategory = useMemo(
    () =>
      ({
        parks: pois.filter((poi) => poi.category === 'parks'),
        groceries: pois.filter((poi) => poi.category === 'groceries'),
        noise: pois.filter((poi) => poi.category === 'noise'),
        transit: pois.filter((poi) => poi.category === 'transit'),
      }) satisfies Record<PoiCategory, Poi[]>,
    [pois],
  )

  const spatialFactorField = useMemo(
    () =>
      buildSpatialFactorField(
        poisByCategory,
        crimeIncidents,
        noiseSegments,
        landPenaltyAreas,
        trafficSegments,
        activeCity.bounds,
        activeCity.center,
        deferredCellSizeMeters,
      ),
    [
      activeCity.center,
      activeCity.bounds,
      deferredCellSizeMeters,
      crimeIncidents,
      landPenaltyAreas,
      noiseSegments,
      poisByCategory,
      trafficSegments,
    ],
  )

  const suitabilityField = useMemo(
    () => mixSuitabilityField(criteria, spatialFactorField, buildingFootprints),
    [buildingFootprints, criteria, spatialFactorField],
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

  const dataCoverage = useMemo(() => {
    const sourceScores = [
      dataMode === 'live' ? 1 : 0.42,
      crimeDataMode === 'live' ? 1 : 0,
      noiseSegments.length > 0 ? 1 : 0,
      trafficSegments.length > 0 ? 1 : 0,
      landPenaltyAreas.length > 0 ? 1 : 0,
    ]

    return sourceScores.reduce((total, score) => total + score, 0) / sourceScores.length
  }, [
    crimeDataMode,
    dataMode,
    landPenaltyAreas.length,
    noiseSegments.length,
    trafficSegments.length,
  ])

  const selectedAnalysis = useMemo(
    () =>
      analyzePoint(
        selectedPoint,
        activeCity,
        criteria,
        suitabilityField,
        poisByCategory,
        crimeIncidents,
        noiseSegments,
        landPenaltyAreas,
        trafficSegments,
        dataCoverage,
      ),
    [
      crimeIncidents,
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
            noiseSegments,
            landPenaltyAreas,
            trafficSegments,
            dataCoverage,
          ),
        }))
        .sort((a, b) => b.analysis.opportunityScore - a.analysis.opportunityScore),
    [
      crimeIncidents,
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
        name: `Точка ${currentSites.length + 1}`,
      }

      if (currentSites.some((site) => site.id === nextSite.id)) {
        return currentSites
      }

      return [...currentSites, nextSite].slice(-5)
    })
  }, [selectedAnalysis, selectedSiteId])

  const averageScore = suitabilityField.averageScore

  const exportReport = useCallback(() => {
    const report = {
      generatedAt: new Date().toISOString(),
      profile: activeProfileId,
      location: { state: activeCity.state, city: activeCity.city },
      gridMeters: appliedCellSizeMeters,
      averageScore,
      selected: selectedAnalysis,
      shortlist: savedSites,
      topZones: neighborhoodScores.slice(0, 8),
      sources: {
        osmAmenities: dataMode,
        crime: crimeDataMode,
        noiseSegments: noiseSegments.length,
        landPenaltyAreas: landPenaltyAreas.length,
        trafficSegments: trafficSegments.length,
        buildings: buildingFootprints.length,
      },
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = 'boston-housing-score-report.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [
    activeProfileId,
    activeCity,
    averageScore,
    appliedCellSizeMeters,
    buildingFootprints.length,
    crimeDataMode,
    dataMode,
    landPenaltyAreas.length,
    neighborhoodScores,
    noiseSegments.length,
    savedSites,
    selectedAnalysis,
    trafficSegments.length,
  ])

  return (
    <div className="app-shell">
      <aside className="control-panel" aria-label="Настройки карты">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Boston</p>
            <h1>Карта пригодности жилья</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={refreshData}
            aria-label="Обновить данные"
            title="Обновить данные"
          >
            {isLoading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
          </button>
        </header>

        <div className="status-strip">
          <span>{dataMode === 'live' ? 'OSM live' : 'Sample'}</span>
          <span>{crimeDataMode === 'live' ? `${crimeIncidents.length} инц.` : 'крим. нет'}</span>
          <span>{appliedCellSizeMeters} м grid</span>
        </div>

        <section className="panel-section">
          <div className="section-title">
            <span>Локация</span>
            <MapPin size={16} />
          </div>
          <div className="select-grid">
            <label className="select-field">
              <span>Штат</span>
              <select
                value={selectedState}
                onChange={(event) => {
                  const nextState = event.target.value

                  setSelectedState(nextState)
                  setCitySearchText(MAJOR_CITIES_BY_STATE[nextState]?.[0] ?? '')
                }}
              >
                {US_STATES.map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-field">
              <span>Город</span>
              <input
                list="major-city-options"
                placeholder={activeCity.city}
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
            </label>
          </div>
          <div className="resolution-row">
            <span>
              Активно: {activeCity.city}, {activeCity.state}
            </span>
            <button
              className="text-button"
              disabled={isSearchingCity || citySearchText.trim().length === 0}
              type="button"
              onClick={searchCity}
            >
              {isSearchingCity ? <Loader2 className="spin" size={15} /> : <MapPin size={15} />}
              Найти
            </button>
          </div>
          <label className="range-row">
            <span>Сетка</span>
            <select
              value={cellSizeMeters}
              onChange={(event) => setCellSizeMeters(Number(event.target.value))}
            >
              {RESOLUTION_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} м
                </option>
              ))}
            </select>
          </label>
          <div className="resolution-row">
            <span>
              {cellSizeMeters === appliedCellSizeMeters
                ? `Активно: ${appliedCellSizeMeters} м`
                : `Выбрано: ${cellSizeMeters} м`}
            </span>
            <button
              className="text-button"
              disabled={cellSizeMeters === appliedCellSizeMeters}
              type="button"
              onClick={applyGridResolution}
            >
              Применить
            </button>
          </div>
        </section>

        <div className="metric-grid">
          <div className="metric-card">
            <BarChart3 size={16} />
            <span>Средний</span>
            <strong>{Math.round(averageScore * 100)}</strong>
          </div>
          <div className="metric-card">
            <Target size={16} />
            <span>Точка</span>
            <strong>{Math.round(selectedAnalysis.score * 100)}</strong>
          </div>
          <div className="metric-card">
            <ShieldAlert size={16} />
            <span>Риск</span>
            <strong>{Math.round(selectedAnalysis.riskScore * 100)}</strong>
          </div>
          <div className="metric-card">
            <Sparkles size={16} />
            <span>Доверие</span>
            <strong>{Math.round(selectedAnalysis.confidence * 100)}</strong>
          </div>
        </div>

        <section className="panel-section">
          <div className="section-title">
            <span>Этажность</span>
            <Building2 size={16} />
          </div>
          <label className="range-row">
            <span>Этаж</span>
            <input
              max="80"
              min="1"
              type="range"
              value={desiredFloor}
              onChange={(event) => setDesiredFloor(Number(event.target.value))}
            />
          </label>
          <div className="source-grid">
            <span>Желаемый этаж</span>
            <strong>{desiredFloor}</strong>
            <span>OSM здания</span>
            <strong>{buildingDataMode === 'loading' ? '...' : buildingFootprints.length}</strong>
            <span>Ближайшее</span>
            <strong>
              {selectedBuilding.building
                ? `${selectedBuilding.building.levels ?? '?'} эт.`
                : 'нет данных'}
            </strong>
            <span>Дистанция</span>
            <strong>
              {selectedBuilding.building ? formatMeters(selectedBuilding.distance) : 'нет данных'}
            </strong>
            <span>Подходит</span>
            <strong>{floorMatch === null ? 'нет данных' : floorMatch ? 'да' : 'нет'}</strong>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Профиль оценки</span>
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
            <span>Оверлей</span>
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
                {mode === 'suitability' ? 'Score' : mode === 'risk' ? 'Risk' : 'Upside'}
              </button>
            ))}
          </div>
          <label className="toggle-row">
            <input
              checked={showOverlay}
              type="checkbox"
              onChange={(event) => setShowOverlay(event.target.checked)}
            />
            <span>Показывать слой</span>
          </label>
          <label className="range-row">
            <span>Прозрачность</span>
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

        <section className="panel-section analysis-card">
          <div className="analysis-head">
            <div>
              <span className="mini-label">Выбранная точка</span>
              <strong>{selectedAnalysis.label}</strong>
            </div>
            <span
              className="score-pill large"
              style={{ backgroundColor: colorForScore(selectedAnalysis.score) }}
            >
              {Math.round(selectedAnalysis.score * 100)}
            </span>
          </div>
          <p className="thesis">{selectedAnalysis.thesis}</p>
          <div className="point-context">
            <div>
              <span>Координаты</span>
              <strong>
                {selectedAnalysis.point.lat.toFixed(5)}, {selectedAnalysis.point.lng.toFixed(5)}
              </strong>
            </div>
            <div>
              <span>Главный плюс</span>
              <strong>{selectedAnalysis.bestFactor.detail}</strong>
            </div>
            <div>
              <span>Главный риск</span>
              <strong>{selectedAnalysis.worstFactor.detail}</strong>
            </div>
            <div>
              <span>Этажность рядом</span>
              <strong>
                {selectedBuilding.building
                  ? `${selectedBuilding.building.levels ?? '?'} эт. · ${formatMeters(selectedBuilding.distance)}`
                  : 'нет данных'}
              </strong>
            </div>
          </div>
          <div className="factor-callouts">
            <span>Сила: {selectedAnalysis.bestFactor.label}</span>
            <span>Риск: {selectedAnalysis.worstFactor.label}</span>
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
              {isSelectedSitePinned ? 'Закреплено' : 'Закрепить'}
            </button>
            <button className="text-button" type="button" onClick={exportReport}>
              <Download size={16} />
              Экспорт
            </button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Критерии</span>
            <button
              className="text-button"
              type="button"
              onClick={() => setShowPois((current) => !current)}
            >
              {showPois ? <EyeOff size={16} /> : <Eye size={16} />}
              {showPois ? 'Скрыть точки' : 'Показать точки'}
            </button>
          </div>

          <div className="criteria-list">
            {criteria.map((criterion) => {
              const Icon =
                criterion.id === 'center'
                  ? Building2
                  : criterion.id === 'crime'
                    ? ShieldAlert
                    : CATEGORY_META[criterion.id].icon
              const pointCount =
                criterion.id === 'center'
                  ? 1
                  : criterion.id === 'crime'
                    ? crimeIncidents.length
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
                    aria-label={`${criterion.label}: вес`}
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
            <span>Сильные зоны</span>
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
            <span>Зоны роста</span>
            <Sparkles size={16} />
          </div>
          <div className="rank-list compact">
            {opportunityZones.slice(0, 5).map((item) => (
              <div className="rank-row" key={item.name}>
                <span className="rank-name">{item.name}</span>
                <span className="score-pair">
                  <span>{Math.round(item.analysis.opportunityScore * 100)} up</span>
                  <strong>{Math.round(item.analysis.riskScore * 100)} risk</strong>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Shortlist</span>
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
              <p className="empty-note">Кликните по карте, чтобы сравнить точки.</p>
            )}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <span>Источники</span>
          </div>
          <div className="source-grid">
            <span>OSM</span>
            <strong>{dataMode === 'live' ? pois.length : FALLBACK_POIS.length}</strong>
            <span>Crime</span>
            <strong>{crimeIncidents.length}</strong>
            <span>Noise</span>
            <strong>{noiseSegments.length}</strong>
            <span>Traffic</span>
            <strong>{trafficSegments.length}</strong>
            <span>Land caps</span>
            <strong>{landPenaltyAreas.length}</strong>
            <span>Buildings</span>
            <strong>{buildingDataMode === 'loading' ? '...' : buildingFootprints.length}</strong>
          </div>
        </section>

        <footer className="panel-footer">
          <div className="legend">
            <span>Пиздец</span>
            <div className="legend-ramp" />
            <span>Топ</span>
          </div>
          <div className="legend-labels" aria-label="Шкала пригодности">
            {SCORE_BANDS.map((band) => (
              <span key={band.range}>
                <i style={{ backgroundColor: band.color }} />
                <strong>{band.range}</strong>
                {band.label}
              </span>
            ))}
          </div>
          {error ? <p className="data-note">Часть live-данных недоступна.</p> : null}
        </footer>
      </aside>

      <main className="map-stage">
        <MapContainer
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
          <ZoomControl position="bottomright" />
          <MapViewportSync bounds={activeCity.bounds} />
          <MapClickSelector onSelect={setSelectedPoint} />
          <SuitabilityCanvasOverlay
            field={suitabilityField}
            mode={layerMode}
            opacity={overlayOpacity}
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
          >
            <Popup>
              <div className="poi-popup">
                <strong>{Math.round(selectedAnalysis.score * 100)} · {selectedAnalysis.label}</strong>
                <span>{selectedAnalysis.worstFactor.label}: {selectedAnalysis.worstFactor.detail}</span>
              </div>
            </Popup>
          </CircleMarker>

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
    </div>
  )
}

export default App

export type LatLng = {
  lat: number
  lng: number
}

export type MapBounds = {
  south: number
  west: number
  north: number
  east: number
}

export type CityConfig = {
  id: string
  state: string
  city: string
  bounds: MapBounds
  center: LatLng
  checkpoints: Array<LatLng & { name: string }>
}

export type PoiCategory = 'parks' | 'groceries' | 'noise' | 'transit'
export type CriterionId = PoiCategory | 'center' | 'crime'

export type Poi = LatLng & {
  id: string
  name: string
  category: PoiCategory
  shopKind?: string
  areaSqm?: number
  parkStrength?: number
  points?: LatLng[]
}

export type CrimeIncident = LatLng & {
  id: string
  description: string
  category: string
}

export type NoiseSourceKind = 'road' | 'rail' | 'airport'

export type NoiseSegment = {
  id: string
  name: string
  kind: NoiseSourceKind
  roadClass?: string
  points: LatLng[]
}

export type LandPenaltyArea = {
  id: string
  name: string
  kind:
    | 'land'
    | 'residential'
    | 'water'
    | 'rail-yard'
    | 'airport'
    | 'industrial'
    | 'open-space'
    | 'parking'
    | 'road'
    | 'commercial'
    | 'civic'
    | 'cemetery'
  points: LatLng[]
  maxScore: number
  isLinear?: boolean
  bufferMeters?: number
}

export type TrafficSegment = {
  id: string
  aadt: number
  year?: number
  points: LatLng[]
}

export type BuildingFootprint = LatLng & {
  id: string
  name: string
  use: 'residential' | 'nonResidential' | 'unknown'
  levels: number | null
  heightMeters: number | null
  points?: LatLng[]
}

export type DataMode = 'live' | 'sample'
export type CrimeDataMode = 'live' | 'empty'
export type BuildingDataMode = 'live' | 'empty' | 'loading' | 'partial'

export type LoadStageId = 'osm' | 'crime' | 'noise' | 'traffic' | 'buildings'
export type LoadStageStatus = 'idle' | 'loading' | 'cached' | 'live' | 'empty' | 'partial' | 'error'

export type LoadStage = {
  label: string
  status: LoadStageStatus
  count?: number
  detail?: string
}

export type MainDataSnapshot = {
  pois: Poi[]
  crimeIncidents: CrimeIncident[]
  noiseSegments: NoiseSegment[]
  landPenaltyAreas: LandPenaltyArea[]
  trafficSegments: TrafficSegment[]
  dataMode: DataMode
  crimeDataMode: CrimeDataMode
}

export type BuildingDataSnapshot = {
  buildingFootprints: BuildingFootprint[]
  buildingDataMode: Exclude<BuildingDataMode, 'loading'>
  buildingTotalCount: number
  buildingIsCapped: boolean
}

export type BuildingFetchResult = {
  buildings: BuildingFootprint[]
  total: number
  isCapped: boolean
}

export type Criterion = {
  id: CriterionId
  label: string
  enabled: boolean
  weight: number
  thresholdKm: number
  mode: 'nearIsGood' | 'farIsGood' | 'belowAverageIsGood'
}

export type EvaluationProfile = {
  id: string
  label: string
  weights: Partial<Record<CriterionId, number>>
}

export type FactorBreakdown = {
  id: CriterionId | 'land'
  label: string
  score: number
  detail: string
  summary?: string
}

export type PointDataItem = {
  label: string
  value: string
  tone: 'good' | 'warn' | 'bad' | 'neutral'
}

export type PointAnalysis = {
  point: LatLng
  score: number
  label: string
  factors: FactorBreakdown[]
  dataCompleteness: PointDataItem[]
  bestFactor: FactorBreakdown
  worstFactor: FactorBreakdown
  riskScore: number
  opportunityScore: number
  confidence: number
  thesis: string
}

export type SavedSite = PointAnalysis & {
  id: string
  name: string
}

export type LayerMode = 'suitability' | 'risk' | 'opportunity'

export type OverpassGeometryPoint = {
  lat: number
  lon: number
}

export type OverpassMember = {
  type: string
  ref: number
  role?: string
  geometry?: OverpassGeometryPoint[]
}

export type OverpassElement = {
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

export type CrimeRecord = {
  _id: number
  INCIDENT_NUMBER?: string
  OFFENSE_DESCRIPTION?: string
  UCR_PART?: string
  Lat?: string | number | null
  Long?: string | number | null
}

export type TrafficRecord = {
  OBJECTID: number
  AADT?: number | null
  AADT_Year?: number | null
}

export type ArcGisPolylineFeature = {
  attributes?: TrafficRecord
  geometry?: {
    paths?: number[][][]
  }
}

export type SuitabilityField = {
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
  roadMaskByCell: Uint8Array
  noGoMaskByCell: Uint8Array
  overlayInclusionMaskByCell: Uint8Array
  overlayExclusionMaskByCell: Uint8Array
  residentialCandidateMaskByCell: Uint8Array
  overlayExclusionAreas: LatLng[][]
  overlayExclusionLines: Array<{ points: LatLng[]; bufferMeters: number; kind: 'road' | 'water' }>
  noGoOverlayAreas: LatLng[][]
  averageScore: number
  evaluatedCellCount: number
  averageCrimeDensity: number
  noiseSegmentCount: number
  trafficSegmentCount: number
  landPenaltyAreaCount: number
}

export type SpatialFactorField = Omit<SuitabilityField, 'averageScore' | 'evaluatedCellCount' | 'scores'> & {
  factorScores: Record<CriterionId, Float32Array>
  landScoreCapByCell: Float32Array
}

export type ProjectedPoi = {
  x: number
  y: number
  shopKind?: string
  areaSqm: number
  parkStrength: number
}

import type { CityConfig, Criterion, EvaluationProfile, LatLng, LoadStage, LoadStageId, Poi } from './types'

export const BOSTON_BOUNDS = {
  south: 42.2279,
  west: -71.1912,
  north: 42.3976,
  east: -70.9234,
}

export const BOSTON_CENTER: LatLng = {
  lat: 42.3555,
  lng: -71.0605,
}

export const DEFAULT_CELL_SIZE_METERS = 100
export const RESOLUTION_OPTIONS = [50, 100, 150, 200, 300] as const
export const CRIME_RADIUS_METERS = 220
export const API_CACHE_VERSION = 'housing-score-v14'
export const API_CACHE_TTL_MS = 1000 * 60 * 60 * 12
export const ZONE_SNAPSHOT_TTL_MS = 1000 * 60 * 10
export const PARK_SCORE_FLOOR = 0.55
export const MAJOR_ROAD_HARD_NOISE_METERS = 30
export const MAJOR_ROAD_SOFT_NOISE_METERS = 180
export const RAIL_HARD_NOISE_METERS = 45
export const RAIL_SOFT_NOISE_METERS = 280
export const AIRPORT_HARD_NOISE_METERS = 900
export const AIRPORT_SOFT_NOISE_METERS = 4200
export const TRAFFIC_MAX_AADT = 85_000
export const BUILDING_MATCH_RADIUS_METERS = 90
export const BUILDING_STORE_LIMIT = 120_000
export const RESIDENTIAL_BUILDING_EVIDENCE_METERS = 95
export const LAND_EVIDENCE_BUFFER_METERS = 125
export const ROAD_SURFACE_NO_GO_BUFFER_METERS = 12
export const METERS_PER_DEGREE_LAT = 111_320
export const CRIME_RESOURCE_ID = 'b973d8cb-eeb2-4e7e-99da-c92938efc9c0'
export const MAX_CITY_LAT_SPAN = 0.12
export const MAX_CITY_LNG_SPAN = 0.14

export const CITY_OPTIONS: CityConfig[] = [
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

export const US_STATES = [
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

export const MAJOR_CITIES_BY_STATE: Record<string, string[]> = {
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

export const INITIAL_CRITERIA: Criterion[] = [
  { id: 'parks', label: 'Парки', enabled: true, weight: 58, thresholdKm: 1.2, mode: 'nearIsGood' },
  { id: 'groceries', label: 'Магазины', enabled: true, weight: 86, thresholdKm: 1, mode: 'nearIsGood' },
  { id: 'noise', label: 'Шум', enabled: true, weight: 76, thresholdKm: 1.15, mode: 'farIsGood' },
  { id: 'transit', label: 'Транспорт', enabled: true, weight: 58, thresholdKm: 0.9, mode: 'nearIsGood' },
  { id: 'center', label: 'Центр', enabled: true, weight: 42, thresholdKm: 8, mode: 'nearIsGood' },
  { id: 'crime', label: 'Криминал', enabled: true, weight: 96, thresholdKm: 1, mode: 'belowAverageIsGood' },
]

export const EVALUATION_PROFILES: EvaluationProfile[] = [
  {
    id: 'balanced',
    label: 'Баланс',
    weights: { parks: 58, groceries: 86, noise: 76, transit: 58, center: 42, crime: 96 },
  },
  {
    id: 'quiet',
    label: 'Тихий премиум',
    weights: { parks: 64, groceries: 64, noise: 100, transit: 38, center: 28, crime: 100 },
  },
  {
    id: 'carfree',
    label: 'Без авто',
    weights: { parks: 50, groceries: 92, noise: 70, transit: 96, center: 68, crime: 88 },
  },
  {
    id: 'family',
    label: 'Семья',
    weights: { parks: 84, groceries: 86, noise: 90, transit: 48, center: 24, crime: 100 },
  },
  {
    id: 'investor',
    label: 'Инвестор',
    weights: { parks: 46, groceries: 78, noise: 72, transit: 86, center: 74, crime: 92 },
  },
]

export const FALLBACK_POIS: Poi[] = [
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

export const INITIAL_LOAD_STAGES: Record<LoadStageId, LoadStage> = {
  osm: { label: 'OSM', status: 'idle' },
  crime: { label: 'Crime', status: 'idle' },
  noise: { label: 'Noise', status: 'idle' },
  traffic: { label: 'Traffic', status: 'idle' },
  buildings: { label: 'Buildings', status: 'idle' },
}

export const SCORE_BANDS = [
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

# Housing Suitability Map / Карта пригодности жилья

Interactive map for comparing places to live with a suitability score instead of a flat list of addresses.

The app blends OpenStreetMap amenities, transit, roads, water/park masks, building footprints, traffic and noise proxies, local fallback datasets, and hard land-use exclusions into a Leaflet overlay. It supports US cities, Russian cities, ZIP search where available, and custom selected regions.

Live demo: https://iddictive.github.io/housing-suitability-map/

## What it shows

- Suitability, risk, and opportunity layers on the same map.
- Hard exclusions for water, parks, bridges, airports, major roads, and clearly non-residential land.
- Search by US state, country/region, city, ZIP code where supported, or a custom selected area.
- Adjustable grid resolution and scoring profiles.
- Point inspector with score, risk, confidence, source context, and pinned locations.
- Progressive loading with local cache and sanitized fallback data.

## Data model

Most regions use OpenStreetMap-derived data:

- Nominatim for city/ZIP geocoding and boundaries.
- Overpass API for amenities, transit, roads, land-use masks, water, parks, and buildings.
- OSM road classes as traffic/noise proxies when official traffic data is not available.

Some datasets are jurisdiction-specific. Boston crime and MassDOT AADT are US/Massachusetts-only; other regions fall back to the generic OSM-based scoring path. The repository does not store private personal records.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

GitHub Pages build:

```bash
GITHUB_PAGES=true npm run build
```

## Stack

- React 19
- TypeScript
- Vite
- Leaflet and React Leaflet
- Turf helpers for distance calculations

---

## Русский

Интерактивная карта для сравнения мест для жизни через suitability score, а не через плоский список адресов.

Приложение смешивает OpenStreetMap-данные по инфраструктуре, транспорту, дорогам, воде/паркам, зданиям, прокси трафика и шума, локальные fallback-наборы и жесткие land-use исключения в Leaflet-оверлее. Поддерживаются города США, города РФ, ZIP search где он доступен, и свои выбранные регионы.

Демо: https://iddictive.github.io/housing-suitability-map/

## Что показывает карта

- Слои suitability, risk и opportunity на одной карте.
- Жесткие исключения для воды, парков, мостов, аэропортов, крупных дорог и явно нежилой земли.
- Поиск по US state, стране/региону, городу, ZIP где поддерживается, или выбранной области.
- Настраиваемое разрешение сетки и scoring profiles.
- Инспектор точки со score, risk, confidence, источниками и pinned locations.
- Постепенная загрузка с локальным cache и очищенными fallback-данными.

## Данные

Большинство регионов используют данные на базе OpenStreetMap:

- Nominatim для геокодинга городов/ZIP и границ.
- Overpass API для amenities, транспорта, дорог, land-use masks, воды, парков и зданий.
- OSM-классы дорог как прокси трафика/шума, если официальных traffic datasets нет.

Часть источников привязана к конкретным юрисдикциям. Boston crime и MassDOT AADT работают только для США/Массачусетса; остальные регионы используют общий OSM-based scoring path. Репозиторий не хранит приватные персональные записи.

## Разработка

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

GitHub Pages build:

```bash
GITHUB_PAGES=true npm run build
```

## Стек

- React 19
- TypeScript
- Vite
- Leaflet и React Leaflet
- Turf helpers для расчетов расстояний

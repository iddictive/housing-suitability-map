# Housing Suitability Map / Карта пригодности жилья

Interactive map for comparing residential suitability across US cities, Russian cities, and selected regions. The app combines amenities, parks, transit, roads, traffic/noise proxies, building data, and hard land-use exclusions into a smooth suitability overlay. US-only safety sources remain limited to the jurisdictions where public datasets are available.

Интерактивная карта для оценки пригодности жилья по городам США, городам РФ и выделенным регионам. Приложение учитывает удобства, парки, транспорт, дороги, прокси трафика/шума, этажность зданий и жесткие исключения по земле в едином плавном оверлее. US-only источники безопасности остаются ограничены юрисдикциями, где есть публичные наборы данных.

Live demo: https://iddictive.github.io/housing-suitability-map/

## Features / Возможности

- Smooth suitability overlay with shared score palette and inspector context.
- Hard exclusions for water, parks, roads, bridges, airports, and clearly non-residential land.
- Search by US state, Russia, city, ZIP code where supported, and custom selected region.
- Progressive loading states with local caching and fallback data.
- Adjustable grid resolution and scoring profiles.
- Point inspector with score, risk, confidence, sources, and pinned locations.

## Development / Разработка

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

## Data Notes / Данные

The app uses public geospatial sources and local sanitized fallback datasets. Russia support uses OpenStreetMap-derived Nominatim geocoding plus Overpass API amenities, transit, roads, land-use masks, and building footprints. Boston crime and MassDOT AADT remain US/MA-only; other regions fall back to OSM road-class traffic proxies. Private personal records are not stored in the repository.

Приложение использует публичные геоданные и локальные очищенные fallback-наборы. Поддержка РФ основана на геокодинге Nominatim по OpenStreetMap и Overpass API для удобств, транспорта, дорог, land-use масок и зданий. Boston crime и MassDOT AADT остаются только для США/MA; остальные регионы используют OSM-прокси трафика по классу дорог. Персональные записи не хранятся в репозитории.

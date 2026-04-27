# Housing Suitability Map / Карта пригодности жилья

Interactive map for comparing residential suitability across US cities and selected regions. The app combines amenities, parks, transit, roads, traffic, noise, crime, building data, and hard land-use exclusions into a smooth suitability overlay.

Интерактивная карта для оценки пригодности жилья по городам и выделенным регионам США. Приложение учитывает удобства, парки, транспорт, дороги, трафик, шум, криминал, этажность зданий и жесткие исключения по земле в едином плавном оверлее.

Live demo: https://iddictive.github.io/housing-suitability-map/

## Features / Возможности

- Smooth suitability overlay with shared score palette and inspector context.
- Hard exclusions for water, parks, roads, bridges, airports, and clearly non-residential land.
- Search by state, city, ZIP code, and custom selected region.
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

The app uses public geospatial sources and local sanitized fallback datasets. Private personal records are not stored in the repository.

Приложение использует публичные геоданные и локальные очищенные fallback-наборы. Персональные записи не хранятся в репозитории.

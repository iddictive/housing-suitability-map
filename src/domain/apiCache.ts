import { API_CACHE_TTL_MS, API_CACHE_VERSION, ZONE_SNAPSHOT_TTL_MS } from './config'
import type { CityConfig, MapBounds, OverpassElement } from './types'

const memoryApiCache = new Map<string, unknown>()
let overpassRequestQueue = Promise.resolve()

const apiCacheKey = (key: string) => `${API_CACHE_VERSION}:${key}`

export const boundsCachePart = (bounds: MapBounds) =>
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

const readAnyApiCache = <T,>(key: string): T | null => {
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

    const cached = JSON.parse(raw) as { value: T }

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

export const cachedRequest = async <T,>(
  key: string,
  request: () => Promise<T>,
  options: { force?: boolean } = {},
) => {
  const stale = readAnyApiCache<T>(key)
  const cached = options.force ? null : readApiCache<T>(key)

  if (cached) {
    return cached
  }

  try {
    const value = await request()

    writeApiCache(key, value)
    return value
  } catch (error) {
    if (stale) {
      return stale
    }

    throw error
  }
}

export const zoneSnapshotKey = (kind: 'main' | 'buildings', city: CityConfig) =>
  `zone-snapshot:${kind}:${city.id}:${boundsCachePart(city.bounds)}`

export const readZoneSnapshot = <T,>(key: string) => readApiCache<T>(key)

export const writeZoneSnapshot = <T,>(key: string, value: T) => {
  writeApiCache(key, value, ZONE_SNAPSHOT_TTL_MS)
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  })

export const fetchOverpassJson = async (
  body: string,
  signal: AbortSignal,
  label: string,
): Promise<{ elements?: OverpassElement[] }> => {
  const run = async () => {
    await wait(850)

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body,
      signal,
    })

    if (!response.ok) {
      throw new Error(`Overpass ${label} ${response.status}`)
    }

    return (await response.json()) as { elements?: OverpassElement[] }
  }
  const result = overpassRequestQueue.then(run, run)

  overpassRequestQueue = result.then(
    () => undefined,
    () => undefined,
  )

  return result
}

import { API_CACHE_TTL_MS, API_CACHE_VERSION, ZONE_SNAPSHOT_TTL_MS } from './config'
import type { CityConfig, MapBounds, OverpassElement } from './types'

const memoryApiCache = new Map<string, unknown>()
let activeOverpassRequests = 0
const overpassRequestQueue: Array<() => void> = []
let nextOverpassEndpointIndex = 0

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const OVERPASS_TIMEOUT_MS = 65_000
const OVERPASS_CONCURRENCY = 2
const OVERPASS_START_DELAY_MS = 180

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

const wait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      globalThis.clearTimeout(timeoutId)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', abort, { once: true })
  })

const releaseOverpassSlot = () => {
  activeOverpassRequests = Math.max(0, activeOverpassRequests - 1)
  const next = overpassRequestQueue.shift()

  if (next) {
    queueMicrotask(next)
  }
}

const acquireOverpassSlot = (signal: AbortSignal) =>
  new Promise<() => void>((resolve, reject) => {
    let queueEntry: (() => void) | null = null

    const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    const abortWhileQueued = () => {
      if (queueEntry) {
        const queueIndex = overpassRequestQueue.indexOf(queueEntry)

        if (queueIndex >= 0) {
          overpassRequestQueue.splice(queueIndex, 1)
        }

        queueEntry = null
      }

      rejectAbort()
    }

    const begin = () => {
      queueEntry = null
      signal.removeEventListener('abort', abortWhileQueued)

      if (signal.aborted) {
        rejectAbort()
        return
      }

      activeOverpassRequests += 1
      let released = false
      const release = () => {
        if (released) {
          return
        }

        released = true
        releaseOverpassSlot()
      }

      wait(OVERPASS_START_DELAY_MS, signal)
        .then(() => resolve(release))
        .catch((error) => {
          release()
          reject(error)
        })
    }

    if (signal.aborted) {
      rejectAbort()
      return
    }

    if (activeOverpassRequests < OVERPASS_CONCURRENCY) {
      begin()
      return
    }

    queueEntry = begin
    signal.addEventListener('abort', abortWhileQueued, { once: true })
    overpassRequestQueue.push(begin)
  })

const orderedOverpassEndpoints = () => {
  const startIndex = nextOverpassEndpointIndex % OVERPASS_ENDPOINTS.length
  nextOverpassEndpointIndex += 1

  return [
    ...OVERPASS_ENDPOINTS.slice(startIndex),
    ...OVERPASS_ENDPOINTS.slice(0, startIndex),
  ]
}

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
) => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  if (signal.aborted) {
    controller.abort()
  } else {
    signal.addEventListener('abort', abort, { once: true })
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

export const fetchOverpassJson = async (
  body: string,
  signal: AbortSignal,
  label: string,
): Promise<{ elements?: OverpassElement[] }> => {
  const release = await acquireOverpassSlot(signal)

  try {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    let lastError: unknown = null
    let lastPayload: { elements?: OverpassElement[] } | null = null

    for (const endpoint of orderedOverpassEndpoints()) {
      try {
        const response = await fetchWithTimeout(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain;charset=UTF-8',
            },
            body,
          },
          signal,
          OVERPASS_TIMEOUT_MS,
        )

        if (!response.ok) {
          throw new Error(`Overpass ${label} ${response.status}`)
        }

        const payload = (await response.json()) as { elements?: OverpassElement[] }
        lastPayload = payload

        if ((payload.elements ?? []).length === 0) {
          await wait(300, signal)
          continue
        }

        return payload
      } catch (error) {
        if (signal.aborted) {
          throw error
        }

        lastError = error
        await wait(300, signal)
      }
    }

    if (lastPayload) {
      return lastPayload
    }

    throw lastError instanceof Error ? lastError : new Error(`Overpass ${label} unavailable`)
  } finally {
    release()
  }
}

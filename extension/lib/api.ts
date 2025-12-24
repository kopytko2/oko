/**
 * API utilities for Oko
 * Provides cached access to connection settings and URL helpers
 */

import { getConnectionSettings, type ResolvedConnection } from './connection'

let cachedSettings: ResolvedConnection | null = null
let cachePromise: Promise<ResolvedConnection> | null = null

/**
 * Get cached connection settings
 * Uses a singleton promise to avoid race conditions during initialization
 * Clears cache on rejection to allow recovery from transient errors
 */
async function getCachedSettings(): Promise<ResolvedConnection> {
  if (cachedSettings) {
    return cachedSettings
  }
  
  if (!cachePromise) {
    cachePromise = getConnectionSettings()
      .then(settings => {
        cachedSettings = settings
        cachePromise = null
        return settings
      })
      .catch(err => {
        // Clear promise on failure to allow retry
        cachePromise = null
        throw err
      })
  }
  
  return cachePromise
}

/**
 * Get the configured API base URL
 */
export async function getApiUrl(): Promise<string> {
  const settings = await getCachedSettings()
  return settings.apiUrl
}

/**
 * Get the configured WebSocket URL
 */
export async function getWsUrl(): Promise<string> {
  const settings = await getCachedSettings()
  return settings.wsUrl
}

/**
 * Get the configured auth token
 */
export async function getAuthToken(): Promise<string> {
  const settings = await getCachedSettings()
  return settings.authToken
}

/**
 * Get all connection settings at once
 */
export async function getConnection(): Promise<ResolvedConnection> {
  return getCachedSettings()
}

/**
 * Build a full API URL from a path
 */
export function buildUrl(baseUrl: string, path: string): string {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  // Ensure baseUrl doesn't end with /
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  return `${normalizedBase}${normalizedPath}`
}

/**
 * Clear the settings cache
 * Call this when settings are updated
 */
export function clearCache(): void {
  cachedSettings = null
  cachePromise = null
}

/**
 * Initialize cache listener for storage changes
 * Automatically clears cache when connection settings change
 */
export function initCacheListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.backendUrl) {
      clearCache()
    }
    if (areaName === 'local' && changes.authToken) {
      clearCache()
    }
  })
}

/**
 * Create headers object with auth token if configured
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken()
  if (token) {
    return { 'X-Auth-Token': token }
  }
  return {}
}

/**
 * Fetch wrapper that automatically includes auth headers
 * Properly handles Headers objects, arrays, and plain objects
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers)
  
  const token = await getAuthToken()
  if (token && !headers.has('X-Auth-Token')) {
    headers.set('X-Auth-Token', token)
  }
  
  return fetch(url, {
    ...options,
    headers
  })
}

/**
 * Build and fetch an API endpoint with auth
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const baseUrl = await getApiUrl()
  const url = buildUrl(baseUrl, path)
  return fetchWithAuth(url, options)
}

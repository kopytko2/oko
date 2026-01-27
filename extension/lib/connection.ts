/**
 * Connection settings management for Oko
 * Handles backend URL configuration and auth token storage
 */

export interface ConnectionSettings {
  backendUrl: string
  authToken: string
}

export interface ResolvedConnection {
  apiUrl: string
  wsUrl: string
  authToken: string
}

/**
 * Normalize and validate a backend URL
 * - Auto-prepends https:// if no scheme provided
 * - Strips trailing slashes
 * - Validates URL format
 * - Returns empty string if no URL configured (requires connection code)
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim()
  
  if (!normalized) {
    return ''
  }
  
  // Auto-prepend https:// if no scheme
  if (!normalized.match(/^https?:\/\//)) {
    normalized = `https://${normalized}`
  }
  
  // Strip trailing slash
  normalized = normalized.replace(/\/+$/, '')
  
  // Validate URL format
  try {
    new URL(normalized)
  } catch {
    throw new Error(`Invalid URL format: ${url}`)
  }
  
  return normalized
}

/**
 * Get connection settings from Chrome storage
 * Backend URL stored in sync storage (shared across devices)
 * Auth token stored in local storage (device-specific, more secure)
 */
export async function getConnectionSettings(): Promise<ResolvedConnection> {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(['backendUrl']),
    chrome.storage.local.get(['authToken'])
  ])
  
  const backendUrl = normalizeUrl(syncData.backendUrl || '')
  if (!backendUrl) {
    throw new Error('No backend URL configured. Paste a connection code in the extension popup.')
  }
  const url = new URL(backendUrl)
  
  // Derive WebSocket URL from HTTP URL
  // Note: backendUrl should be origin-only (no pathname). Any pathname is ignored
  // for WebSocket connections since WS connects to the root.
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${url.host}`
  
  return {
    apiUrl: backendUrl,
    wsUrl,
    authToken: localData.authToken || ''
  }
}

/**
 * Save connection settings to Chrome storage
 */
export async function saveConnectionSettings(settings: ConnectionSettings): Promise<void> {
  const normalizedUrl = normalizeUrl(settings.backendUrl)
  
  await Promise.all([
    chrome.storage.sync.set({ backendUrl: normalizedUrl }),
    chrome.storage.local.set({ authToken: settings.authToken })
  ])
}

/**
 * Test connection to a backend URL
 * Returns success/failure with optional error message
 */
export async function testConnection(
  backendUrl: string,
  authToken?: string
): Promise<{ success: boolean; error?: string; latencyMs?: number }> {
  const startTime = Date.now()
  
  try {
    const normalizedUrl = normalizeUrl(backendUrl)
    const headers: Record<string, string> = {}
    
    if (authToken) {
      headers['X-Auth-Token'] = authToken
    }
    
    const response = await fetch(`${normalizedUrl}/api/health`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000)
    })
    
    const latencyMs = Date.now() - startTime
    
    if (response.ok) {
      return { success: true, latencyMs }
    }
    
    if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'Authentication failed - check auth token' }
    }
    
    return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        return { success: false, error: 'Connection timed out (5s)' }
      }
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        return { success: false, error: 'Cannot reach server - check URL and network' }
      }
      return { success: false, error: err.message }
    }
    return { success: false, error: 'Connection failed' }
  }
}

/**
 * Clear stored connection settings
 */
export async function clearConnectionSettings(): Promise<void> {
  await Promise.all([
    chrome.storage.sync.remove(['backendUrl']),
    chrome.storage.local.remove(['authToken'])
  ])
}

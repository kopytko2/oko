/**
 * Network Capture Handler
 * Captures and stores network requests using chrome.webRequest API
 * 
 * IMPORTANT: MV3 State Volatility
 * --------------------------------
 * This module uses in-memory Maps to store captured requests. In Manifest V3,
 * the service worker can be suspended at any time, which will clear this state.
 * 
 * Current behavior: "Best effort" capture - data may be lost on suspension.
 * 
 * Mitigation strategies (not yet implemented):
 * 1. Use chrome.storage.session for persistence across suspensions
 * 2. Push captured data to backend immediately as it arrives
 * 3. Accept data loss and document it as expected behavior
 * 
 * The keepalive alarm in websocket.ts helps prevent suspension during active
 * capture, but Chrome can still suspend the worker under memory pressure.
 */

import { sendToWebSocket } from '../websocket'

// =============================================================================
// TYPES
// =============================================================================

interface CapturedRequest {
  requestId: string
  url: string
  method: string
  type: chrome.webRequest.ResourceType
  tabId: number
  startTime: number
  endTime?: number
  durationMs?: number
  requestHeaders?: Array<{ name: string; value?: string }>
  responseHeaders?: Array<{ name: string; value?: string }>
  statusCode?: number
  statusLine?: string
  fromCache?: boolean
  error?: string
}

interface CaptureConfig {
  enabled: boolean
  tabId?: number // If set, only capture for this tab
  urlFilter?: string[] // URL patterns to capture
  maxRequests: number
  redactHeaders: string[] // Headers to redact (case-insensitive)
}

// =============================================================================
// STATE
// =============================================================================

const capturedRequests: Map<string, CapturedRequest> = new Map()
let captureConfig: CaptureConfig = {
  enabled: false,
  maxRequests: 1000,
  redactHeaders: ['authorization', 'cookie', 'set-cookie', 'x-auth-token']
}
const CAPTURE_TTL_MS = 30 * 60 * 1000
const CAPTURE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let lastCleanupTime = 0

// Track listeners to avoid duplicate registration
let listenersRegistered = false

// =============================================================================
// HEADER REDACTION
// =============================================================================

/**
 * Redact sensitive headers from request/response
 */
function redactHeaders(
  headers: Array<{ name: string; value?: string }> | undefined
): Array<{ name: string; value?: string }> | undefined {
  if (!headers) return undefined
  
  return headers.map(h => {
    const nameLower = h.name.toLowerCase()
    if (captureConfig.redactHeaders.some(r => nameLower === r.toLowerCase())) {
      return { name: h.name, value: '[REDACTED]' }
    }
    return { name: h.name, value: h.value }
  })
}

function normalizeTabId(tabId: unknown): number | undefined {
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0) {
    return undefined
  }
  return tabId
}

// =============================================================================
// CAPTURE LISTENERS
// =============================================================================

/**
 * Check if URL matches any of the configured filter patterns
 */
function matchesUrlFilter(url: string): boolean {
  if (!captureConfig.urlFilter || captureConfig.urlFilter.length === 0) {
    return true // No filter = capture all
  }
  
  return captureConfig.urlFilter.some(pattern => {
    try {
      const regex = new RegExp(pattern, 'i')
      return regex.test(url)
    } catch {
      // Invalid regex pattern, skip
      return false
    }
  })
}

function pruneCapturedRequests(now: number): void {
  if (capturedRequests.size === 0) return
  const cutoff = now - CAPTURE_TTL_MS
  for (const [id, req] of capturedRequests) {
    if (req.startTime < cutoff) {
      capturedRequests.delete(id)
    }
  }
}

function maybePruneCapturedRequests(): void {
  const now = Date.now()
  if (now - lastCleanupTime < CAPTURE_CLEANUP_INTERVAL_MS) return
  lastCleanupTime = now
  pruneCapturedRequests(now)
}

function onBeforeRequest(
  details: chrome.webRequest.WebRequestBodyDetails
): void {
  if (!captureConfig.enabled) return
  if (captureConfig.tabId !== undefined && details.tabId !== captureConfig.tabId) return
  
  // Apply URL filter at capture time
  if (!matchesUrlFilter(details.url)) return

  maybePruneCapturedRequests()
  
  // Enforce max requests limit
  if (capturedRequests.size >= captureConfig.maxRequests) {
    // Remove oldest request
    const oldest = capturedRequests.keys().next().value
    if (oldest) capturedRequests.delete(oldest)
  }
  
  capturedRequests.set(details.requestId, {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    tabId: details.tabId,
    startTime: details.timeStamp
  })
}

function onSendHeaders(
  details: chrome.webRequest.WebRequestHeadersDetails
): void {
  if (!captureConfig.enabled) return
  
  const request = capturedRequests.get(details.requestId)
  if (request) {
    request.requestHeaders = redactHeaders(details.requestHeaders)
  }
}

function onHeadersReceived(
  details: chrome.webRequest.WebResponseHeadersDetails
): void {
  if (!captureConfig.enabled) return
  
  const request = capturedRequests.get(details.requestId)
  if (request) {
    request.responseHeaders = redactHeaders(details.responseHeaders)
    request.statusCode = details.statusCode
    request.statusLine = details.statusLine
  }
}

function onCompleted(
  details: chrome.webRequest.WebResponseCacheDetails
): void {
  if (!captureConfig.enabled) return
  
  const request = capturedRequests.get(details.requestId)
  if (request) {
    request.fromCache = details.fromCache
    request.endTime = details.timeStamp
    request.durationMs = details.timeStamp - request.startTime
  }
}

function onErrorOccurred(
  details: chrome.webRequest.WebResponseErrorDetails
): void {
  if (!captureConfig.enabled) return
  
  const request = capturedRequests.get(details.requestId)
  if (request) {
    request.error = details.error
    request.endTime = details.timeStamp
    request.durationMs = details.timeStamp - request.startTime
  }
}

// =============================================================================
// LISTENER MANAGEMENT
// =============================================================================

function registerListeners(): void {
  if (listenersRegistered) return
  
  const filter: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'] }
  
  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter)
  chrome.webRequest.onSendHeaders.addListener(
    onSendHeaders, 
    filter, 
    ['requestHeaders']
  )
  chrome.webRequest.onHeadersReceived.addListener(
    onHeadersReceived, 
    filter, 
    ['responseHeaders']
  )
  chrome.webRequest.onCompleted.addListener(onCompleted, filter)
  chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, filter)
  
  listenersRegistered = true
  console.log('[Network] Listeners registered')
}

function unregisterListeners(): void {
  if (!listenersRegistered) return
  
  chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest)
  chrome.webRequest.onSendHeaders.removeListener(onSendHeaders)
  chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived)
  chrome.webRequest.onCompleted.removeListener(onCompleted)
  chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred)
  
  listenersRegistered = false
  console.log('[Network] Listeners unregistered')
}

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

interface EnableNetworkCaptureMessage {
  requestId: string
  tabId?: number
  urlFilter?: string[]
  maxRequests?: number
  redactHeaders?: string[]
}

interface GetNetworkRequestsMessage {
  requestId: string
  tabId?: number
  type?: string
  urlPattern?: string
  limit?: number
  offset?: number
}

interface ClearNetworkRequestsMessage {
  requestId: string
  tabId?: number
}

/**
 * Enable network capture
 */
export function handleEnableNetworkCapture(message: EnableNetworkCaptureMessage): void {
  const tabId = normalizeTabId(message.tabId)
  captureConfig = {
    enabled: true,
    tabId,
    urlFilter: message.urlFilter,
    maxRequests: message.maxRequests || 1000,
    redactHeaders: message.redactHeaders || ['authorization', 'cookie', 'set-cookie', 'x-auth-token']
  }
  
  registerListeners()
  
  sendToWebSocket({
    type: 'browser-enable-network-capture-result',
    requestId: message.requestId,
    success: true,
    config: {
      tabId: captureConfig.tabId,
      maxRequests: captureConfig.maxRequests,
      redactHeaders: captureConfig.redactHeaders
    }
  })
}

/**
 * Disable network capture
 */
export function handleDisableNetworkCapture(message: { requestId: string }): void {
  captureConfig.enabled = false
  unregisterListeners()
  
  sendToWebSocket({
    type: 'browser-disable-network-capture-result',
    requestId: message.requestId,
    success: true
  })
}

/**
 * Get captured network requests with filtering and pagination
 */
export function handleGetNetworkRequests(message: GetNetworkRequestsMessage): void {
  maybePruneCapturedRequests()
  let requests = Array.from(capturedRequests.values())
  
  // Filter by tab
  const tabId = normalizeTabId(message.tabId)
  if (tabId !== undefined) {
    requests = requests.filter(r => r.tabId === tabId)
  }
  
  // Filter by type
  if (message.type) {
    requests = requests.filter(r => r.type === message.type)
  }
  
  // Filter by URL pattern
  if (message.urlPattern) {
    try {
      const regex = new RegExp(message.urlPattern, 'i')
      requests = requests.filter(r => regex.test(r.url))
    } catch {
      // Invalid regex, skip filter
    }
  }
  
  // Sort by startTime (newest first)
  requests.sort((a, b) => b.startTime - a.startTime)
  
  // Pagination
  const offset = message.offset || 0
  const limit = message.limit || 100
  const total = requests.length
  const paginated = requests.slice(offset, offset + limit)
  
  sendToWebSocket({
    type: 'browser-get-network-requests-result',
    requestId: message.requestId,
    success: true,
    total,
    offset,
    limit,
    requests: paginated
  })
}

setInterval(() => {
  pruneCapturedRequests(Date.now())
}, CAPTURE_CLEANUP_INTERVAL_MS)

/**
 * Clear captured network requests
 */
export function handleClearNetworkRequests(message: ClearNetworkRequestsMessage): void {
  const tabId = normalizeTabId(message.tabId)
  if (tabId !== undefined) {
    // Clear only for specific tab
    for (const [id, req] of capturedRequests) {
      if (req.tabId === tabId) {
        capturedRequests.delete(id)
      }
    }
  } else {
    // Clear all
    capturedRequests.clear()
  }
  
  sendToWebSocket({
    type: 'browser-clear-network-requests-result',
    requestId: message.requestId,
    success: true,
    remaining: capturedRequests.size
  })
}

/**
 * Get capture status
 */
export function handleGetNetworkCaptureStatus(message: { requestId: string }): void {
  sendToWebSocket({
    type: 'browser-get-network-capture-status-result',
    requestId: message.requestId,
    success: true,
    enabled: captureConfig.enabled,
    capturedCount: capturedRequests.size,
    config: captureConfig.enabled ? {
      tabId: captureConfig.tabId,
      maxRequests: captureConfig.maxRequests
    } : null
  })
}

/**
 * Debugger-based Network Capture
 * Uses Chrome DevTools Protocol to capture full request/response bodies
 * 
 * IMPORTANT: MV3 State Volatility
 * --------------------------------
 * This module uses in-memory Maps to store captured requests and debugger sessions.
 * In Manifest V3, the service worker can be suspended, which will:
 * 1. Clear all captured request data
 * 2. Lose track of active debugger sessions (though Chrome may keep them attached)
 * 
 * Current behavior: "Best effort" capture with explicit enable/disable lifecycle.
 * Users should disable debugger capture when done to avoid orphaned sessions.
 */

import { sendToWebSocket } from '../websocket'

// =============================================================================
// TYPES
// =============================================================================

interface DebuggerRequest {
  requestId: string
  url: string
  method: string
  resourceType: string
  tabId: number
  timestamp: number
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  status?: number
  statusCode?: number
  mimeType?: string
  encodedDataLength?: number
  initiator?: Record<string, unknown>
  documentURL?: string
  frameId?: string
  markerRefs?: string[]
  requestFingerprint?: string
  error?: string
}

interface DebuggerMarker {
  id: string
  ts: number
  markerType: 'phase' | 'action-start' | 'action-end'
  label: string
  meta?: Record<string, unknown>
}

interface DebuggerSession {
  tabId: number
  attached: boolean
  requests: Map<string, DebuggerRequest>
  maxRequests: number
  urlFilter?: string[]
  captureBody: boolean
  exposeSensitiveHeaders: boolean
  markers: DebuggerMarker[]
  activeActionMarkerIds: Set<string>
  latestPhaseMarkerId?: string
}

// =============================================================================
// STATE
// =============================================================================

const sessions: Map<number, DebuggerSession> = new Map()
const SAFE_MAX_BODY_SIZE = 1024 * 1024 // 1MB in safe mode
const REDACTED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'x-api-key'
])

function matchesUrlFilter(url: string, filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true
  return filter.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(url)
    } catch {
      return url.includes(pattern)
    }
  })
}

function toHeaderMap(
  headers: unknown,
  exposeSensitiveHeaders: boolean
): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined

  const mapped: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(headers as Record<string, unknown>)) {
    const key = String(rawKey)
    if (!exposeSensitiveHeaders && REDACTED_HEADERS.has(key.toLowerCase())) continue
    mapped[key] = String(rawValue)
  }
  return mapped
}

function normalizePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment
      if (/^\d+$/.test(segment)) return '{id}'
      if (/^[0-9a-f]{24,}$/i.test(segment)) return '{hex}'
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return '{uuid}'
      if (/^[A-Za-z0-9_-]{20,}$/.test(segment)) return '{token}'
      return segment
    })
    .join('/')
}

function buildRequestFingerprint(method: string, rawUrl: string, resourceType: string): string {
  try {
    const parsed = new URL(rawUrl)
    const normalizedPath = normalizePathname(parsed.pathname)
    return `${method.toUpperCase()} ${parsed.origin}${normalizedPath} [${resourceType || 'unknown'}]`
  } catch {
    return `${method.toUpperCase()} ${rawUrl} [${resourceType || 'unknown'}]`
  }
}

// =============================================================================
// DEBUGGER EVENT HANDLERS
// =============================================================================

function onDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: object
): void {
  const p = params as Record<string, unknown> | undefined
  const tabId = source.tabId
  if (!tabId) return
  
  const session = sessions.get(tabId)
  if (!session) return
  
  switch (method) {
    case 'Network.requestWillBeSent': {
      const requestId = p?.requestId as string
      const request = p?.request as Record<string, unknown>
      const requestUrl = request?.url as string
      const requestMethod = request?.method as string
      const resourceType = p?.type as string
      const markerRefs = [
        ...(session.latestPhaseMarkerId ? [session.latestPhaseMarkerId] : []),
        ...Array.from(session.activeActionMarkerIds),
      ]
      
      if (session.requests.size >= session.maxRequests) {
        // Remove oldest request
        const oldest = session.requests.keys().next().value
        if (oldest) session.requests.delete(oldest)
      }
      
      session.requests.set(requestId, {
        requestId,
        url: requestUrl,
        method: requestMethod,
        resourceType,
        tabId,
        timestamp: Date.now(),
        requestHeaders: toHeaderMap(request?.headers, session.exposeSensitiveHeaders),
        initiator: (p?.initiator as Record<string, unknown>) || undefined,
        documentURL: typeof p?.documentURL === 'string' ? p.documentURL as string : undefined,
        frameId: typeof p?.frameId === 'string' ? p.frameId as string : undefined,
        markerRefs: markerRefs.length > 0 ? markerRefs : undefined,
        requestFingerprint: buildRequestFingerprint(requestMethod || 'GET', requestUrl || '', resourceType || ''),
      })

      if (!requestId || !request?.url || !matchesUrlFilter(String(request.url), session.urlFilter)) {
        session.requests.delete(requestId)
        break
      }

      if (session.captureBody && request?.hasPostData) {
        const req = session.requests.get(requestId)
        if (req) {
          void fetchRequestPostData(tabId, requestId, req)
        }
      }
      break
    }
    
    case 'Network.responseReceived': {
      const requestId = p?.requestId as string
      const response = p?.response as Record<string, unknown>
      const req = session.requests.get(requestId)
      
      if (req) {
        req.statusCode = response?.status as number
        req.status = response?.status as number
        req.mimeType = response?.mimeType as string
        req.responseHeaders = toHeaderMap(response?.headers, session.exposeSensitiveHeaders)
        req.encodedDataLength = response?.encodedDataLength as number
      }
      break
    }
    
    case 'Network.loadingFinished': {
      const requestId = p?.requestId as string
      const req = session.requests.get(requestId)
      
      if (req && tabId && session.captureBody) {
        // Fetch response body
        void fetchResponseBody(tabId, requestId, req, session.exposeSensitiveHeaders)
      }
      break
    }
    
    case 'Network.loadingFailed': {
      const requestId = p?.requestId as string
      const req = session.requests.get(requestId)
      
      if (req) {
        req.error = p?.errorText as string
      }
      break
    }
  }
}

async function fetchRequestPostData(
  tabId: number,
  requestId: string,
  req: DebuggerRequest
): Promise<void> {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      'Network.getRequestPostData',
      { requestId }
    ) as { postData: string }
    if (typeof result?.postData === 'string') {
      req.requestBody = result.postData
    }
  } catch {
    // Post data is not available for all requests.
  }
}

async function fetchResponseBody(
  tabId: number,
  requestId: string,
  req: DebuggerRequest,
  exposeSensitiveHeaders: boolean
): Promise<void> {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      'Network.getResponseBody',
      { requestId }
    ) as { body: string; base64Encoded: boolean }
    
    if (result?.body) {
      if (exposeSensitiveHeaders) {
        req.responseBody = result.body
      } else if (result.body.length <= SAFE_MAX_BODY_SIZE) {
        req.responseBody = result.base64Encoded
          ? `[base64] ${result.body.slice(0, 1000)}...`
          : result.body
      } else {
        req.responseBody = `[truncated: ${result.body.length} bytes]`
      }
    }
  } catch {
    // Body may not be available for all requests
  }
}

function onDebuggerDetach(source: chrome.debugger.Debuggee, _reason: string): void {
  const tabId = source.tabId
  if (tabId) {
    const session = sessions.get(tabId)
    if (session) {
      session.attached = false
    }
  }
}

// Register global debugger listeners once
let listenersRegistered = false
function ensureListeners(): void {
  if (listenersRegistered) return
  chrome.debugger.onEvent.addListener(onDebuggerEvent)
  chrome.debugger.onDetach.addListener(onDebuggerDetach)
  listenersRegistered = true
}

// =============================================================================
// PUBLIC HANDLERS
// =============================================================================

export interface EnableDebuggerMessage {
  requestId: string
  tabId: number
  maxRequests?: number
  urlFilter?: string[]
  captureBody?: boolean
  mode?: 'safe' | 'full'
}

export async function handleEnableDebuggerCapture(message: EnableDebuggerMessage): Promise<void> {
  const { requestId, tabId, maxRequests = 100 } = message
  const mode = message.mode === 'safe' ? 'safe' : 'full'
  const captureBody = message.captureBody !== false && mode === 'full'
  const exposeSensitiveHeaders = mode === 'full'
  
  try {
    ensureListeners()
    
    // Check if already attached
    const session = sessions.get(tabId)
    if (session?.attached) {
      sendToWebSocket({
        type: 'browser-enable-debugger-capture-result',
        requestId,
        success: true,
        message: 'Debugger already attached'
      })
      return
    }
    
    // Attach debugger
    await chrome.debugger.attach({ tabId }, '1.3')
    
    // Enable network domain
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {})
    
    // Create session
    sessions.set(tabId, {
      tabId,
      attached: true,
      requests: new Map(),
      maxRequests,
      urlFilter: message.urlFilter,
      captureBody,
      exposeSensitiveHeaders,
      markers: [],
      activeActionMarkerIds: new Set()
    })
    
    sendToWebSocket({
      type: 'browser-enable-debugger-capture-result',
      requestId,
      success: true,
      tabId
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-enable-debugger-capture-result',
      requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export interface DisableDebuggerMessage {
  requestId: string
  tabId: number
}

export async function handleDisableDebuggerCapture(message: DisableDebuggerMessage): Promise<void> {
  const { requestId, tabId } = message
  
  try {
    const session = sessions.get(tabId)
    
    if (session?.attached) {
      await chrome.debugger.detach({ tabId })
    }
    
    sessions.delete(tabId)
    
    sendToWebSocket({
      type: 'browser-disable-debugger-capture-result',
      requestId,
      success: true
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-disable-debugger-capture-result',
      requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export interface GetDebuggerRequestsMessage {
  requestId: string
  tabId: number
  urlPattern?: string
  resourceType?: string
  limit?: number
  offset?: number
  sinceTs?: number
  untilTs?: number
  markerId?: string
  includeMarkers?: boolean
  includeInitiator?: boolean
  includeFrame?: boolean
}

export function handleGetDebuggerRequests(message: GetDebuggerRequestsMessage): void {
  const {
    requestId,
    tabId,
    urlPattern,
    resourceType,
    limit = 50,
    offset = 0,
    sinceTs,
    untilTs,
    markerId,
    includeMarkers = false,
    includeInitiator = false,
    includeFrame = false,
  } = message
  
  const session = sessions.get(tabId)
  
  if (!session) {
    sendToWebSocket({
      type: 'browser-get-debugger-requests-result',
      requestId,
      success: false,
      error: 'No debugger session for this tab'
    })
    return
  }
  
  let requests = Array.from(session.requests.values())
  
  // Filter by URL pattern
  if (urlPattern) {
    try {
      const regex = new RegExp(urlPattern, 'i')
      requests = requests.filter(r => regex.test(r.url))
    } catch {
      // Invalid regex, skip filter
    }
  }
  
  // Filter by resource type
  if (resourceType) {
    requests = requests.filter(r => r.resourceType === resourceType)
  }

  if (typeof sinceTs === 'number') {
    requests = requests.filter((r) => (r.timestamp || 0) >= sinceTs)
  }
  if (typeof untilTs === 'number') {
    requests = requests.filter((r) => (r.timestamp || 0) <= untilTs)
  }
  if (markerId) {
    requests = requests.filter((r) => Array.isArray(r.markerRefs) && r.markerRefs.includes(markerId))
  }
  
  // Sort by timestamp descending (newest first)
  requests.sort((a, b) => b.timestamp - a.timestamp)
  
  // Paginate
  const total = requests.length
  const paginated = requests.slice(offset, offset + limit)
  const shaped = paginated.map((request) => {
    const row = { ...request }
    if (!includeInitiator) {
      delete row.initiator
    }
    if (!includeFrame) {
      delete row.frameId
      delete row.documentURL
    }
    if (!includeMarkers) {
      delete row.markerRefs
    }
    return row
  })
  
  sendToWebSocket({
    type: 'browser-get-debugger-requests-result',
    requestId,
    success: true,
    requests: shaped,
    markers: includeMarkers ? session.markers : undefined,
    total,
    limit,
    offset
  })
}

export interface DebuggerMarkMessage {
  requestId: string
  tabId: number
  markerType: 'phase' | 'action-start' | 'action-end'
  label: string
  meta?: Record<string, unknown>
}

export function handleDebuggerMark(message: DebuggerMarkMessage): void {
  const { requestId, tabId, markerType, label, meta } = message
  const session = sessions.get(tabId)

  if (!session) {
    sendToWebSocket({
      type: 'browser-debugger-mark-result',
      requestId,
      success: false,
      error: 'No debugger session for this tab'
    })
    return
  }

  const marker: DebuggerMarker = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    markerType,
    label,
    meta,
  }

  session.markers.push(marker)
  if (session.markers.length > 500) {
    session.markers.shift()
  }

  if (markerType === 'phase') {
    session.latestPhaseMarkerId = marker.id
  } else if (markerType === 'action-start') {
    session.activeActionMarkerIds.add(marker.id)
  } else if (markerType === 'action-end') {
    session.activeActionMarkerIds.clear()
  }

  sendToWebSocket({
    type: 'browser-debugger-mark-result',
    requestId,
    success: true,
    marker,
  })
}

export interface ClearDebuggerRequestsMessage {
  requestId: string
  tabId: number
}

export function handleClearDebuggerRequests(message: ClearDebuggerRequestsMessage): void {
  const { requestId, tabId } = message
  
  const session = sessions.get(tabId)
  
  if (session) {
    session.requests.clear()
    session.markers = []
    session.activeActionMarkerIds.clear()
    session.latestPhaseMarkerId = undefined
  }
  
  sendToWebSocket({
    type: 'browser-clear-debugger-requests-result',
    requestId,
    success: true
  })
}

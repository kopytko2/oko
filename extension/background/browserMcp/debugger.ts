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
  statusCode?: number
  mimeType?: string
  encodedDataLength?: number
  error?: string
}

interface DebuggerSession {
  tabId: number
  attached: boolean
  requests: Map<string, DebuggerRequest>
  maxRequests: number
}

// =============================================================================
// STATE
// =============================================================================

const sessions: Map<number, DebuggerSession> = new Map()
const MAX_BODY_SIZE = 1024 * 1024 // 1MB max body capture

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
      
      if (session.requests.size >= session.maxRequests) {
        // Remove oldest request
        const oldest = session.requests.keys().next().value
        if (oldest) session.requests.delete(oldest)
      }
      
      session.requests.set(requestId, {
        requestId,
        url: request?.url as string,
        method: request?.method as string,
        resourceType: p?.type as string,
        tabId,
        timestamp: Date.now(),
        requestHeaders: request?.headers as Record<string, string>
      })
      break
    }
    
    case 'Network.responseReceived': {
      const requestId = p?.requestId as string
      const response = p?.response as Record<string, unknown>
      const req = session.requests.get(requestId)
      
      if (req) {
        req.statusCode = response?.status as number
        req.mimeType = response?.mimeType as string
        req.responseHeaders = response?.headers as Record<string, string>
        req.encodedDataLength = response?.encodedDataLength as number
      }
      break
    }
    
    case 'Network.loadingFinished': {
      const requestId = p?.requestId as string
      const req = session.requests.get(requestId)
      
      if (req && tabId) {
        // Fetch response body
        void fetchResponseBody(tabId, requestId, req)
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

async function fetchResponseBody(
  tabId: number,
  requestId: string,
  req: DebuggerRequest
): Promise<void> {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      'Network.getResponseBody',
      { requestId }
    ) as { body: string; base64Encoded: boolean }
    
    if (result?.body) {
      // Limit body size
      if (result.body.length <= MAX_BODY_SIZE) {
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

function onDebuggerDetach(source: chrome.debugger.Debuggee, reason: string): void {
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
}

export async function handleEnableDebuggerCapture(message: EnableDebuggerMessage): Promise<void> {
  const { requestId, tabId, maxRequests = 100 } = message
  
  try {
    ensureListeners()
    
    // Check if already attached
    let session = sessions.get(tabId)
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
      maxRequests
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
}

export function handleGetDebuggerRequests(message: GetDebuggerRequestsMessage): void {
  const { requestId, tabId, urlPattern, resourceType, limit = 50, offset = 0 } = message
  
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
  
  // Sort by timestamp descending (newest first)
  requests.sort((a, b) => b.timestamp - a.timestamp)
  
  // Paginate
  const total = requests.length
  const paginated = requests.slice(offset, offset + limit)
  
  sendToWebSocket({
    type: 'browser-get-debugger-requests-result',
    requestId,
    success: true,
    requests: paginated,
    total,
    limit,
    offset
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
  }
  
  sendToWebSocket({
    type: 'browser-clear-debugger-requests-result',
    requestId,
    success: true
  })
}

/**
 * WebSocket connection management for Oko
 * Handles connection to backend, reconnection, and message routing
 */

import { createLogger } from './logger'
import * as connectionState from './connectionState'
import { DEFAULT_RETRY_CONFIG } from './errors'
import {
  ws, setWs,
  broadcastToClients, flushElementSelections
} from './state'
import { getConnection, buildUrl } from '../lib/api'
import {
  handleGetElementInfo,
  handleClickElement,
  handleFillInput
} from './browserMcp/elements'
import {
  handleEnableNetworkCapture,
  handleDisableNetworkCapture,
  handleGetNetworkRequests,
  handleClearNetworkRequests
} from './browserMcp/network'
import {
  handleEnableDebuggerCapture,
  handleDisableDebuggerCapture,
  handleGetDebuggerRequests,
  handleClearDebuggerRequests
} from './browserMcp/debugger'
import {
  safeParseBrowserRequest,
} from '@oko/shared'

const log = createLogger('WebSocket')

const ALARM_WS_RECONNECT = 'ws-reconnect'

interface ValidMessage {
  type: string
  requestId?: string
  [key: string]: unknown
}

function isValidMessage(msg: unknown): msg is ValidMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as Record<string, unknown>).type === 'string'
  )
}

// Forward declaration for reconnect scheduler
let scheduleReconnectFn: (() => void) | null = null
let connectInFlight: Promise<void> | null = null
const PING_INTERVAL_MS = 30000
let pingIntervalId: ReturnType<typeof setInterval> | null = null
let manualDisconnect = false

/**
 * Check if WebSocket is currently connected
 */
export function isWebSocketConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN
}

/**
 * Update extension badge to show connection state
 */
function updateBadge(connected: boolean): void {
  if (connected) {
    chrome.action.setBadgeText({ text: '' })
    chrome.action.setBadgeBackgroundColor({ color: '#069F00' })
  } else {
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setBadgeBackgroundColor({ color: '#E90007' })
  }
}

/**
 * Get current reconnect attempts from connection state
 */
function getReconnectAttempts(): number {
  return connectionState.getState().connection.reconnectAttempts
}

export function setScheduleReconnect(fn: () => void): void {
  scheduleReconnectFn = fn
}

function startPing(): void {
  if (pingIntervalId !== null) return
  pingIntervalId = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
    }
  }, PING_INTERVAL_MS)
}

function stopPing(): void {
  if (pingIntervalId === null) return
  clearInterval(pingIntervalId)
  pingIntervalId = null
}

/**
 * Send message to WebSocket
 */
export function sendToWebSocket(data: unknown): void {
  // Reset manualDisconnect if connection is open (handles race condition with storage change events)
  if (ws?.readyState === WebSocket.OPEN && manualDisconnect) {
    manualDisconnect = false
  }
  
  if (manualDisconnect) return
  
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data))
    } catch (err) {
      log.error('Failed to send to WebSocket', err instanceof Error ? err : undefined)
    }
  } else {
    log.error('WebSocket not connected', undefined, { state: ws?.readyState })
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectWebSocket()
    }
  }
}

/**
 * Connect to backend WebSocket using configured URL and auth
 */
export async function connectWebSocket(): Promise<void> {
  if (connectInFlight) {
    return connectInFlight
  }

  manualDisconnect = false

  if (ws?.readyState === WebSocket.OPEN) {
    log.debug('WebSocket already connected')
    return
  }

  if (ws?.readyState === WebSocket.CONNECTING) {
    log.debug('WebSocket already connecting')
    return
  }

  if (ws) {
    try {
      ws.close()
    } catch {
      // close() can throw if socket is in weird state
    }
    setWs(null)
  }

  const connectAttempt = (async () => {
    let connection
    try {
      connection = await getConnection()
    } catch (err) {
      // No URL configured yet - wait for user to paste connection code
      log.info('No backend URL configured')
      return
    }
    const wsUrl = connection.wsUrl

    // Fetch fresh token from backend, fall back to stored token
    let authToken: string | null = null
    try {
      const tokenUrl = buildUrl(connection.apiUrl, '/api/auth/token')
      const headers: Record<string, string> = {}
      if (connection.authToken) {
        headers['X-Auth-Token'] = connection.authToken
      }
      
      const tokenResponse = await fetch(tokenUrl, { headers })
      if (tokenResponse.ok) {
        const data = await tokenResponse.json()
        if (data.token) {
          authToken = data.token
          log.debug('Got auth token from backend')
        }
      }
    } catch (err) {
      log.warn('Failed to fetch token from backend', { error: err instanceof Error ? err.message : String(err) })
    }
    
    if (!authToken && connection.authToken) {
      authToken = connection.authToken
      log.debug('Using configured auth token')
    }

    connectionState.setConnecting(wsUrl)
    log.info('Connecting to WebSocket', { url: wsUrl })
    const newWs = new WebSocket(wsUrl)
    setWs(newWs)

    newWs.onopen = () => {
      // Guard against stale socket callbacks after reconnect
      if (ws !== newWs) {
        try { newWs.close() } catch { /* ignore */ }
        return
      }

      log.info('WebSocket connected, authenticating')
      
      // Token sent in first message, not URL, to avoid logging in server/proxy logs
      if (authToken) {
        newWs.send(JSON.stringify({ type: 'auth', token: authToken }))
      } else if (wsUrl.includes('localhost') || wsUrl.includes('127.0.0.1')) {
        // Localhost connections auto-authenticate on server side
        onAuthSuccess(newWs)
      } else {
        log.error('No auth token available for remote connection')
        newWs.close(4001, 'No auth token')
        return
      }
    }
    
    newWs.onmessage = (event) => {
      if (ws !== newWs) return
      try {
        const message = JSON.parse(event.data) as unknown
        
        if (!isValidMessage(message)) {
          log.warn('Invalid message format', { data: typeof event.data })
          return
        }
        
        if (message.type === 'auth-success') {
          onAuthSuccess(newWs)
          return
        }
        
        routeWebSocketMessage(message).catch(err => {
          log.error('Message handler failed', err instanceof Error ? err : undefined, { type: message.type })
        })
      } catch (err) {
        log.error('Failed to parse WebSocket message', err instanceof Error ? err : undefined)
      }
    }
    
    function onAuthSuccess(socket: WebSocket) {
      log.info('WebSocket authenticated')
      connectionState.setConnected()
      chrome.alarms.clear(ALARM_WS_RECONNECT)
      startPing()

      socket.send(JSON.stringify({ type: 'identify', clientType: 'extension' }))
      broadcastToClients({ type: 'WS_CONNECTED' })
      
      // Send any element selections that were queued while disconnected
      const queued = flushElementSelections()
      if (queued.length > 0) {
        log.info('Flushing queued element selections', { count: queued.length })
        for (const item of queued) {
          sendToWebSocket({ type: 'element-selected', element: item.element })
        }
      }
      
      updateBadge(true)
    }

    newWs.onerror = (error) => {
      if (ws !== newWs) return
      log.error('WebSocket error', undefined, { error: String(error) })
    }

    newWs.onclose = (event) => {
      if (ws !== newWs) return
      
      const codeDescriptions: Record<number, string> = {
        1000: 'Normal closure',
        1001: 'Going away',
        1006: 'Abnormal closure (connection lost)',
        4001: 'Unauthorized'
      }
      
      const closeReason = codeDescriptions[event.code] || 'Unknown'
      log.info('WebSocket closed', {
        code: event.code,
        description: closeReason,
        reason: event.reason || '(no reason)'
      })

      setWs(null)
      stopPing()
      connectionState.setDisconnected(closeReason)
      broadcastToClients({ type: 'WS_DISCONNECTED' })
      updateBadge(false)

      if (!manualDisconnect && scheduleReconnectFn && connectionState.canReconnect(DEFAULT_RETRY_CONFIG.maxAttempts)) {
        scheduleReconnectFn()
      }
    }
  })()

  connectInFlight = connectAttempt
  try {
    await connectAttempt
  } finally {
    if (connectInFlight === connectAttempt) {
      connectInFlight = null
    }
  }
}

export function disconnectWebSocket(): void {
  manualDisconnect = true
  chrome.alarms.clear(ALARM_WS_RECONNECT)
  stopPing()
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    try {
      ws.close(1000, 'Manual disconnect')
    } catch {
      // Ignore close errors.
    }
  }
}

/**
 * Route incoming WebSocket messages to appropriate handlers
 */
async function routeWebSocketMessage(message: ValidMessage): Promise<void> {
  const { type } = message

  // Browser MCP responses - forward to clients
  if (type?.startsWith('browser-') && type.endsWith('-result')) {
    broadcastToClients({
      type: 'BROWSER_MCP_RESULT',
      data: message
    })
    return
  }

  // Health/status messages
  if (type === 'pong') {
    return
  }

  if (type === 'health') {
    return
  }

  // Browser MCP requests - validate with shared schema and handle
  if (type.startsWith('browser-') && !type.endsWith('-result')) {
    // Validate against shared schema
    const validated = safeParseBrowserRequest(message)
    if (!validated) {
      log.warn('Invalid browser request format', { type, message })
      // Still try to handle it for backwards compatibility
    }
    await handleBrowserRequest(type, message)
    return
  }

  // Forward other messages as generic WS_MESSAGE
  broadcastToClients({
    type: 'WS_MESSAGE',
    data: message
  })
}

/**
 * Handle browser automation requests from backend
 */
async function handleBrowserRequest(type: string, message: ValidMessage): Promise<void> {
  const requestId = message.requestId
  
  if (!requestId || typeof requestId !== 'string') {
    log.error('Browser request missing requestId', undefined, { type })
    return
  }
  
  try {
    switch (type) {
      // Tab management
      case 'browser-list-tabs': {
        const tabs = await chrome.tabs.query({})
        sendToWebSocket({
          type: 'browser-list-tabs-result',
          requestId,
          success: true,
          tabs: tabs.map(t => ({
            id: t.id,
            url: t.url,
            title: t.title,
            active: t.active,
            windowId: t.windowId,
            index: t.index
          }))
        })
        break
      }
      
      case 'browser-navigate': {
        const url = message.url as string
        const tabId = message.tabId as number | undefined
        const newTab = message.newTab as boolean | undefined
        const active = message.active as boolean ?? true
        
        let tab: chrome.tabs.Tab
        if (newTab) {
          tab = await chrome.tabs.create({ url, active })
        } else if (tabId) {
          tab = await chrome.tabs.update(tabId, { url, active })
        } else {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (activeTab?.id) {
            tab = await chrome.tabs.update(activeTab.id, { url })
          } else {
            tab = await chrome.tabs.create({ url, active })
          }
        }
        
        sendToWebSocket({
          type: 'browser-navigate-result',
          requestId,
          success: true,
          tab: { id: tab.id, url: tab.url, title: tab.title }
        })
        break
      }
      
      case 'browser-screenshot': {
        const tabId = message.tabId as number | undefined
        const fullPage = message.fullPage as boolean | undefined
        
        let targetTabId = tabId
        if (!targetTabId) {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
          targetTabId = activeTab?.id
        }
        
        if (!targetTabId) {
          throw new Error('No tab available for screenshot')
        }
        
        // For full page, we'd need to scroll and stitch - for now just capture visible
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' })
        
        sendToWebSocket({
          type: 'browser-screenshot-result',
          requestId,
          success: true,
          screenshot: dataUrl,
          fullPage: fullPage ?? false
        })
        break
      }
      
      // Element operations (delegated to browserMcp/elements.ts)
      case 'browser-get-element-info': {
        await handleGetElementInfo(message as unknown as Parameters<typeof handleGetElementInfo>[0])
        break
      }
      
      case 'browser-click-element': {
        await handleClickElement(message as unknown as Parameters<typeof handleClickElement>[0])
        break
      }
      
      case 'browser-fill-input': {
        await handleFillInput(message as unknown as Parameters<typeof handleFillInput>[0])
        break
      }
      
      // Network capture (delegated to browserMcp/network.ts)
      case 'browser-enable-network-capture': {
        handleEnableNetworkCapture(message as unknown as Parameters<typeof handleEnableNetworkCapture>[0])
        break
      }
      
      case 'browser-disable-network-capture': {
        handleDisableNetworkCapture(message as unknown as Parameters<typeof handleDisableNetworkCapture>[0])
        break
      }
      
      case 'browser-get-network-requests': {
        handleGetNetworkRequests(message as unknown as Parameters<typeof handleGetNetworkRequests>[0])
        break
      }
      
      case 'browser-clear-network-requests': {
        handleClearNetworkRequests(message as unknown as Parameters<typeof handleClearNetworkRequests>[0])
        break
      }
      
      // Debugger-based capture (delegated to browserMcp/debugger.ts)
      case 'browser-enable-debugger-capture': {
        await handleEnableDebuggerCapture(message as unknown as Parameters<typeof handleEnableDebuggerCapture>[0])
        break
      }
      
      case 'browser-disable-debugger-capture': {
        await handleDisableDebuggerCapture(message as unknown as Parameters<typeof handleDisableDebuggerCapture>[0])
        break
      }
      
      case 'browser-get-debugger-requests': {
        handleGetDebuggerRequests(message as unknown as Parameters<typeof handleGetDebuggerRequests>[0])
        break
      }
      
      case 'browser-clear-debugger-requests': {
        handleClearDebuggerRequests(message as unknown as Parameters<typeof handleClearDebuggerRequests>[0])
        break
      }
      
      default:
        log.warn('Unhandled browser request type', { type })
        sendToWebSocket({
          type: `${type}-result`,
          requestId,
          success: false,
          error: `Unknown request type: ${type}`
        })
    }
  } catch (err) {
    log.error('Browser request failed', err instanceof Error ? err : undefined, { type })
    sendToWebSocket({
      type: `${type}-result`,
      requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Schedule WebSocket reconnection using Chrome alarms
 * Alarms survive service worker idle/termination
 */
export function scheduleReconnect(): void {
  if (manualDisconnect) {
    log.debug('Auto-reconnect disabled (manual disconnect)')
    return
  }
  
  const currentAttempts = getReconnectAttempts()
  const nextAttempt = currentAttempts + 1
  
  if (!connectionState.canReconnect(DEFAULT_RETRY_CONFIG.maxAttempts)) {
    log.warn('Max reconnect attempts reached', { attempts: currentAttempts })
    return
  }

  connectionState.setReconnecting(nextAttempt)

  // Exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s
  const delaySeconds = Math.min(Math.pow(2, nextAttempt - 1), 30)
  log.info('Scheduling reconnect', { delaySeconds, attempt: nextAttempt })
  
  chrome.alarms.create(ALARM_WS_RECONNECT, {
    delayInMinutes: delaySeconds / 60
  })
}

// Set up the reconnect function
setScheduleReconnect(scheduleReconnect)

/**
 * Initialize WebSocket alarm listener
 */
export function initWebSocketAlarms(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_WS_RECONNECT) {
      log.debug('Reconnect alarm fired')
      connectWebSocket()
    }
  })
}

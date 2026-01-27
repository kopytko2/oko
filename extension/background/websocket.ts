/**
 * WebSocket connection management for Oko
 * Handles connection to backend, reconnection, and message routing
 */

import { createLogger } from './logger'
import { getConnectionSettings } from './storage'
import * as connectionState from './connectionState'
import { handleError, DEFAULT_RETRY_CONFIG } from './errors'
import {
  ws, setWs,
  broadcastToClients, flushElementSelections
} from './state'
import { getConnection, buildUrl } from '../lib/api'

const log = createLogger('WebSocket')

// Alarm name for reconnection
const ALARM_WS_RECONNECT = 'ws-reconnect'

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
  if (manualDisconnect) return
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  } else {
    log.error('WebSocket not connected', undefined, { state: ws?.readyState })
    // Try to reconnect if not connected
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      log.info('Attempting to reconnect WebSocket')
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

  // Already connected
  if (ws?.readyState === WebSocket.OPEN) {
    log.debug('WebSocket already connected')
    return
  }

  // Already connecting
  if (ws?.readyState === WebSocket.CONNECTING) {
    log.debug('WebSocket already connecting')
    return
  }

  // Close any existing connection
  if (ws) {
    try {
      ws.close()
    } catch {
      // Ignore errors when closing
    }
    setWs(null)
  }

  const connectAttempt = (async () => {
    // Get connection settings
    const connection = await getConnection()
    let wsUrl = connection.wsUrl

    // Try to fetch auth token from backend, fall back to configured token
    let tokenAcquired = false
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
          wsUrl = `${connection.wsUrl}?token=${data.token}`
          tokenAcquired = true
          log.debug('Got auth token from backend for WebSocket')
        }
      }
    } catch (err) {
      log.warn('Failed to fetch token from backend', { error: err instanceof Error ? err.message : String(err) })
    }
    
    // Fall back to configured auth token if backend didn't provide one
    if (!tokenAcquired && connection.authToken) {
      wsUrl = `${connection.wsUrl}?token=${connection.authToken}`
      log.debug('Using configured auth token for WebSocket')
    }

    connectionState.setConnecting(wsUrl.replace(/token=.*/, 'token=***'))
    log.info('Connecting to WebSocket', { url: wsUrl.replace(/token=.*/, 'token=***') })
    const newWs = new WebSocket(wsUrl)
    setWs(newWs)

    newWs.onopen = () => {
      if (ws !== newWs) {
        try {
          newWs.close()
        } catch {
          // Ignore close errors for stale sockets.
        }
        return
      }

      log.info('WebSocket connected')
      connectionState.setConnected()
      chrome.alarms.clear(ALARM_WS_RECONNECT)
      startPing()

      // Identify as extension client
      sendToWebSocket({ type: 'identify', clientType: 'extension' })
      broadcastToClients({ type: 'WS_CONNECTED' })
      
      // Flush any queued element selections
      const queued = flushElementSelections()
      if (queued.length > 0) {
        log.info('Flushing queued element selections', { count: queued.length })
        for (const item of queued) {
          sendToWebSocket({ type: 'element-selected', element: item.element })
        }
      }
      
      // Update badge to show connected
      updateBadge(true)
    }

    newWs.onmessage = (event) => {
      if (ws !== newWs) return
      try {
        const message = JSON.parse(event.data)
        routeWebSocketMessage(message)
      } catch (err) {
        log.error('Failed to parse WebSocket message', err instanceof Error ? err : undefined)
      }
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
      
      // Update badge to show disconnected
      updateBadge(false)

      // Schedule reconnection
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
function routeWebSocketMessage(message: Record<string, unknown>): void {
  const type = message.type as string

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

  // Forward other messages as generic WS_MESSAGE
  broadcastToClients({
    type: 'WS_MESSAGE',
    data: message
  })
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

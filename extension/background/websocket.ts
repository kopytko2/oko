/**
 * WebSocket connection management for Oko
 * Handles connection to backend, reconnection, and message routing
 */

import {
  ws, setWs, wsReconnectAttempts, setWsReconnectAttempts, incrementWsReconnectAttempts,
  MAX_RECONNECT_ATTEMPTS, ALARM_WS_RECONNECT,
  broadcastToClients
} from './state'
import { getConnection, buildUrl } from '../lib/api'

// Forward declaration for reconnect scheduler
let scheduleReconnectFn: (() => void) | null = null

export function setScheduleReconnect(fn: () => void): void {
  scheduleReconnectFn = fn
}

/**
 * Send message to WebSocket
 */
export function sendToWebSocket(data: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  } else {
    console.error('[Background] WebSocket not connected. State:', ws?.readyState)
    // Try to reconnect if not connected
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      console.log('[Background] Attempting to reconnect WebSocket...')
      connectWebSocket()
    }
  }
}

/**
 * Connect to backend WebSocket using configured URL and auth
 */
export async function connectWebSocket(): Promise<void> {
  // Already connected
  if (ws?.readyState === WebSocket.OPEN) {
    console.log('[Background] WebSocket already connected')
    return
  }

  // Already connecting
  if (ws?.readyState === WebSocket.CONNECTING) {
    console.log('[Background] WebSocket already connecting')
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
        console.log('[Background] Got auth token from backend for WebSocket')
      }
    }
  } catch (err) {
    console.log('[Background] Failed to fetch token from backend:', err)
  }
  
  // Fall back to configured auth token if backend didn't provide one
  if (!tokenAcquired && connection.authToken) {
    wsUrl = `${connection.wsUrl}?token=${connection.authToken}`
    console.log('[Background] Using configured auth token for WebSocket')
  }

  console.log('[Background] Connecting to WebSocket:', wsUrl.replace(/token=.*/, 'token=***'))
  const newWs = new WebSocket(wsUrl)
  setWs(newWs)

  newWs.onopen = () => {
    console.log('[Background] WebSocket connected')
    setWsReconnectAttempts(0)
    chrome.alarms.clear(ALARM_WS_RECONNECT)

    // Identify as extension client
    sendToWebSocket({ type: 'identify', clientType: 'extension' })
    broadcastToClients({ type: 'WS_CONNECTED' })
  }

  newWs.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      routeWebSocketMessage(message)
    } catch (err) {
      console.error('[Background] Failed to parse WebSocket message:', err)
    }
  }

  newWs.onerror = (error) => {
    console.error('[Background] WebSocket error:', error)
  }

  newWs.onclose = (event) => {
    const codeDescriptions: Record<number, string> = {
      1000: 'Normal closure',
      1001: 'Going away',
      1006: 'Abnormal closure (connection lost)',
      4001: 'Unauthorized'
    }
    console.log('[Background] WebSocket closed:', {
      code: event.code,
      description: codeDescriptions[event.code] || 'Unknown',
      reason: event.reason || '(no reason)'
    })

    setWs(null)
    broadcastToClients({ type: 'WS_DISCONNECTED' })

    // Schedule reconnection
    if (scheduleReconnectFn && wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      scheduleReconnectFn()
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
  if (type === 'pong' || type === 'health') {
    return // Silently handle keepalive
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
  const attempts = incrementWsReconnectAttempts()
  
  if (attempts > MAX_RECONNECT_ATTEMPTS) {
    console.log('[Background] Max reconnect attempts reached')
    return
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s
  const delaySeconds = Math.min(Math.pow(2, attempts - 1), 30)
  console.log(`[Background] Scheduling reconnect in ${delaySeconds}s (attempt ${attempts})`)
  
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
      console.log('[Background] Reconnect alarm fired')
      connectWebSocket()
    }
  })
}

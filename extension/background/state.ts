/**
 * Shared state for background service worker
 * Centralized state management for WebSocket connection and clients
 */

// WebSocket connection to backend
export let ws: WebSocket | null = null
export let wsReconnectAttempts = 0
export const MAX_RECONNECT_ATTEMPTS = 10

// Alarm names for service worker persistence
export const ALARM_WS_RECONNECT = 'ws-reconnect'

// Track connected clients (popup, sidepanel, devtools)
export const connectedClients = new Set<chrome.runtime.Port>()

// State setters
export function setWs(newWs: WebSocket | null): void {
  ws = newWs
}

export function setWsReconnectAttempts(attempts: number): void {
  wsReconnectAttempts = attempts
}

export function incrementWsReconnectAttempts(): number {
  wsReconnectAttempts++
  return wsReconnectAttempts
}

// Message types for extension communication
export interface ExtensionMessage {
  type: string
  [key: string]: unknown
}

/**
 * Broadcast message to all connected extension pages
 */
export function broadcastToClients(message: ExtensionMessage): void {
  connectedClients.forEach(port => {
    try {
      port.postMessage(message)
    } catch (err) {
      console.error('[Background] Failed to send message to client:', err)
      connectedClients.delete(port)
    }
  })
}

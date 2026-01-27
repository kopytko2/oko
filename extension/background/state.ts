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

// Queue for element selections when WebSocket is disconnected
export interface QueuedElement {
  element: Record<string, unknown>
  timestamp: number
}
export const pendingElementSelections: QueuedElement[] = []
const MAX_QUEUED_SELECTIONS = 10
const QUEUE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function queueElementSelection(element: Record<string, unknown>): void {
  // Remove expired entries
  const now = Date.now()
  while (pendingElementSelections.length > 0 && 
         now - pendingElementSelections[0].timestamp > QUEUE_TTL_MS) {
    pendingElementSelections.shift()
  }
  
  // Add new selection
  pendingElementSelections.push({ element, timestamp: now })
  
  // Trim to max size (keep most recent)
  while (pendingElementSelections.length > MAX_QUEUED_SELECTIONS) {
    pendingElementSelections.shift()
  }
  
  console.log(`[Background] Queued element selection (${pendingElementSelections.length} pending)`)
}

export function flushElementSelections(): QueuedElement[] {
  const items = [...pendingElementSelections]
  pendingElementSelections.length = 0
  return items
}

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

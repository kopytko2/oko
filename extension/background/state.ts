/**
 * Shared state for background service worker
 * 
 * This module holds runtime state that doesn't fit in connectionState.ts
 * (which handles connection state machine) or storage.ts (which handles persistence).
 */

import { createLogger } from './logger'
import * as connectionState from './connectionState'

const log = createLogger('State')

// WebSocket connection to backend
export let ws: WebSocket | null = null

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
  const now = Date.now()
  let droppedCount = 0
  
  // Remove expired entries
  while (pendingElementSelections.length > 0 && 
         now - (pendingElementSelections[0]?.timestamp ?? 0) > QUEUE_TTL_MS) {
    pendingElementSelections.shift()
    droppedCount++
  }
  
  // Add new selection
  pendingElementSelections.push({ element, timestamp: now })
  
  // Trim to max size (keep most recent)
  while (pendingElementSelections.length > MAX_QUEUED_SELECTIONS) {
    pendingElementSelections.shift()
    droppedCount++
  }
  
  // Update connection state for observability
  connectionState.updateQueueState({
    length: pendingElementSelections.length,
    droppedCount,
    oldestTimestamp: pendingElementSelections[0]?.timestamp ?? null
  })
  
  log.info('Queued element selection', { pending: pendingElementSelections.length, dropped: droppedCount })
}

export function flushElementSelections(): QueuedElement[] {
  const items = [...pendingElementSelections]
  pendingElementSelections.length = 0
  
  // Reset queue state
  connectionState.updateQueueState({
    length: 0,
    droppedCount: 0,
    oldestTimestamp: null
  })
  
  return items
}

// State setters
export function setWs(newWs: WebSocket | null): void {
  ws = newWs
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
      log.error('Failed to send message to client', err instanceof Error ? err : undefined)
      connectedClients.delete(port)
    }
  })
}

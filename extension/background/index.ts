/**
 * Oko Background Service Worker
 * Entry point for the extension's background processes
 */

import { connectedClients, ws, queueElementSelection } from './state'
import { connectWebSocket, disconnectWebSocket, initWebSocketAlarms, sendToWebSocket } from './websocket'
import { initCacheListener } from '../lib/api'

// Initialize on service worker start
console.log('[Background] Oko service worker starting')

// Set up cache invalidation listener
initCacheListener()

// Set up WebSocket alarm handlers
initWebSocketAlarms()

// Connect to backend
connectWebSocket()

// Handle extension page connections
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Background] Client connected:', port.name)
  connectedClients.add(port)

  port.onDisconnect.addListener(() => {
    console.log('[Background] Client disconnected:', port.name)
    connectedClients.delete(port)
  })

  port.onMessage.addListener((message) => {
    handleClientMessage(port, message)
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type as string | undefined
  if (type === 'DISCONNECT') {
    disconnectWebSocket()
    sendResponse({ success: true })
    return true
  }
  if (type === 'RECONNECT') {
    connectWebSocket()
    sendResponse({ success: true })
    return true
  }
  if (type === 'GET_WS_STATUS') {
    sendResponse({ connected: ws?.readyState === WebSocket.OPEN })
    return true
  }
  if (type === 'ELEMENT_SELECTED') {
    const element = message.element as Record<string, unknown>
    element.tabId = sender.tab?.id
    
    if (ws?.readyState === WebSocket.OPEN) {
      sendToWebSocket({ type: 'element-selected', element })
    } else {
      // Queue for later when connection is restored
      queueElementSelection(element)
      // Try to reconnect
      connectWebSocket()
    }
    sendResponse({ success: true })
    return true
  }
  return false
})

/**
 * Handle messages from extension pages
 */
function handleClientMessage(
  port: chrome.runtime.Port,
  message: Record<string, unknown>
): void {
  const type = message.type as string

  switch (type) {
    case 'GET_CONNECTION_STATUS':
      // Return current WebSocket connection status
      port.postMessage({
        type: 'CONNECTION_STATUS',
        connected: ws?.readyState === WebSocket.OPEN
      })
      break

    case 'RECONNECT':
      // Force reconnection
      connectWebSocket()
      break

    default:
      console.log('[Background] Unknown message type:', type)
  }
}

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason)
})

// Keep service worker alive with periodic alarm
chrome.alarms.create('keepalive', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Just log to keep service worker active
    console.log('[Background] Keepalive ping')
  }
})

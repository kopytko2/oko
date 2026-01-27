/**
 * Oko Background Service Worker
 * Entry point for the extension's background processes
 */

import { createLogger } from './logger'
import { initStorage, onStorageChange } from './storage'
import * as connectionState from './connectionState'
import { connectedClients, queueElementSelection, broadcastToClients } from './state'
import { connectWebSocket, disconnectWebSocket, initWebSocketAlarms, sendToWebSocket, isWebSocketConnected } from './websocket'
import { initCacheListener } from '../lib/api'

const log = createLogger('Background')

/**
 * Initialize the background service worker
 */
async function init(): Promise<void> {
  log.info('Oko service worker starting')
  
  // Initialize storage wrapper
  await initStorage()
  
  // Set up cache invalidation listener
  initCacheListener()
  
  // Set up WebSocket alarm handlers
  initWebSocketAlarms()
  
  // Listen for storage changes to trigger reconnection
  onStorageChange((change) => {
    if (change.key === 'backendUrl' || change.key === 'authToken') {
      log.info('Connection settings changed, reconnecting')
      disconnectWebSocket()
      connectWebSocket()
    }
  })
  
  // Only auto-connect if URL is already configured
  const settings = await chrome.storage.sync.get(['backendUrl'])
  if (settings.backendUrl) {
    connectWebSocket()
  } else {
    log.info('No backend URL configured, waiting for connection code')
  }
}

// Handle extension page connections
chrome.runtime.onConnect.addListener((port) => {
  log.debug('Client connected', { name: port.name })
  connectedClients.add(port)

  port.onDisconnect.addListener(() => {
    log.debug('Client disconnected', { name: port.name })
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
    connectionState.setDisconnected('Manual disconnect')
    sendResponse({ success: true })
    return true
  }
  if (type === 'RECONNECT') {
    connectWebSocket()
    sendResponse({ success: true })
    return true
  }
  if (type === 'GET_WS_STATUS') {
    const state = connectionState.getState()
    sendResponse({ 
      connected: isWebSocketConnected(),
      status: state.connection.status,
      reconnectAttempts: state.connection.reconnectAttempts
    })
    return true
  }
  if (type === 'GET_STATE') {
    sendResponse(connectionState.getState())
    return true
  }
  if (type === 'ELEMENT_SELECTED') {
    const element = message.element as Record<string, unknown>
    element.tabId = sender.tab?.id
    
    if (isWebSocketConnected()) {
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
        connected: isWebSocketConnected(),
        state: connectionState.getState()
      })
      break

    case 'RECONNECT':
      // Force reconnection
      connectWebSocket()
      break

    default:
      log.debug('Unknown message type', { type })
  }
}

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  log.info('Extension installed/updated', { reason: details.reason })
})

// Keep service worker alive with periodic alarm
chrome.alarms.create('keepalive', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    log.debug('Keepalive ping')
  }
})

// Start initialization
void init()

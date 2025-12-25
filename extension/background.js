/**
 * Oko Background Service Worker (Bundled)
 * Browser automation for Ona environments
 */

// =============================================================================
// CONNECTION SETTINGS
// =============================================================================

const DEFAULT_BACKEND_URL = 'http://localhost:8129'

function normalizeUrl(url) {
  let normalized = url.trim()
  if (!normalized) return DEFAULT_BACKEND_URL
  if (!normalized.match(/^https?:\/\//)) {
    normalized = `https://${normalized}`
  }
  normalized = normalized.replace(/\/+$/, '')
  try {
    new URL(normalized)
  } catch {
    throw new Error(`Invalid URL format: ${url}`)
  }
  return normalized
}

async function getConnectionSettings() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(['backendUrl']),
    chrome.storage.local.get(['authToken'])
  ])
  
  const backendUrl = normalizeUrl(syncData.backendUrl || DEFAULT_BACKEND_URL)
  const url = new URL(backendUrl)
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${url.host}`
  
  return {
    apiUrl: backendUrl,
    wsUrl,
    authToken: localData.authToken || ''
  }
}

function buildUrl(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  return `${normalizedBase}${normalizedPath}`
}

// =============================================================================
// STATE
// =============================================================================

let ws = null
let wsReconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const ALARM_WS_RECONNECT = 'ws-reconnect'
const connectedClients = new Set()

function broadcastToClients(message) {
  connectedClients.forEach(port => {
    try {
      port.postMessage(message)
    } catch (err) {
      console.error('[Background] Failed to send message to client:', err)
      connectedClients.delete(port)
    }
  })
}

// =============================================================================
// WEBSOCKET
// =============================================================================

function sendToWebSocket(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  } else {
    console.error('[Background] WebSocket not connected. State:', ws?.readyState)
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectWebSocket()
    }
  }
}

async function connectWebSocket() {
  if (ws?.readyState === WebSocket.OPEN) return
  if (ws?.readyState === WebSocket.CONNECTING) return

  if (ws) {
    try { ws.close() } catch {}
    ws = null
  }

  const connection = await getConnectionSettings()
  let wsUrl = connection.wsUrl

  // Try to fetch auth token from backend
  let tokenAcquired = false
  try {
    const tokenUrl = buildUrl(connection.apiUrl, '/api/auth/token')
    const headers = {}
    if (connection.authToken) {
      headers['X-Auth-Token'] = connection.authToken
    }
    
    const tokenResponse = await fetch(tokenUrl, { headers })
    if (tokenResponse.ok) {
      const data = await tokenResponse.json()
      if (data.token) {
        wsUrl = `${connection.wsUrl}?token=${data.token}`
        tokenAcquired = true
      }
    }
  } catch (err) {
    console.log('[Background] Failed to fetch token from backend:', err)
  }
  
  if (!tokenAcquired && connection.authToken) {
    wsUrl = `${connection.wsUrl}?token=${connection.authToken}`
  }

  console.log('[Background] Connecting to WebSocket:', wsUrl.replace(/token=.*/, 'token=***'))
  const newWs = new WebSocket(wsUrl)
  ws = newWs

  newWs.onopen = () => {
    console.log('[Background] WebSocket connected')
    wsReconnectAttempts = 0
    chrome.alarms.clear(ALARM_WS_RECONNECT)
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
    console.log('[Background] WebSocket closed:', event.code, event.reason)
    ws = null
    broadcastToClients({ type: 'WS_DISCONNECTED' })
    
    if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      scheduleReconnect()
    }
  }
}

function routeWebSocketMessage(message) {
  const type = message.type

  if (type?.startsWith('browser-') && type.endsWith('-result')) {
    broadcastToClients({ type: 'BROWSER_MCP_RESULT', data: message })
    return
  }

  if (type === 'pong' || type === 'health') return

  // Handle browser MCP requests from backend
  if (type === 'browser-list-tabs') {
    handleListTabs(message)
  } else if (type === 'browser-screenshot') {
    handleScreenshot(message)
  } else if (type === 'browser-get-element-info') {
    handleGetElementInfo(message)
  } else if (type === 'browser-click-element') {
    handleClickElement(message)
  } else if (type === 'browser-fill-input') {
    handleFillInput(message)
  } else if (type === 'browser-enable-network-capture') {
    handleEnableNetworkCapture(message)
  } else if (type === 'browser-disable-network-capture') {
    handleDisableNetworkCapture(message)
  } else if (type === 'browser-get-network-requests') {
    handleGetNetworkRequests(message)
  } else if (type === 'browser-clear-network-requests') {
    handleClearNetworkRequests(message)
  } else {
    broadcastToClients({ type: 'WS_MESSAGE', data: message })
  }
}

function scheduleReconnect() {
  wsReconnectAttempts++
  if (wsReconnectAttempts > MAX_RECONNECT_ATTEMPTS) return
  
  const delaySeconds = Math.min(Math.pow(2, wsReconnectAttempts - 1), 30)
  console.log(`[Background] Scheduling reconnect in ${delaySeconds}s (attempt ${wsReconnectAttempts})`)
  
  chrome.alarms.create(ALARM_WS_RECONNECT, { delayInMinutes: delaySeconds / 60 })
}

// =============================================================================
// NETWORK CAPTURE
// =============================================================================

const capturedRequests = new Map()
let captureConfig = {
  enabled: false,
  maxRequests: 1000,
  redactHeaders: ['authorization', 'cookie', 'set-cookie', 'x-auth-token']
}
let networkListenersRegistered = false

function redactHeaders(headers) {
  if (!headers) return undefined
  return headers.map(h => {
    const nameLower = h.name.toLowerCase()
    if (captureConfig.redactHeaders.some(r => nameLower === r.toLowerCase())) {
      return { name: h.name, value: '[REDACTED]' }
    }
    return h
  })
}

function matchesUrlFilter(url) {
  if (!captureConfig.urlFilter || captureConfig.urlFilter.length === 0) return true
  return captureConfig.urlFilter.some(pattern => {
    try {
      return new RegExp(pattern, 'i').test(url)
    } catch {
      return false
    }
  })
}

function onBeforeRequest(details) {
  if (!captureConfig.enabled) return
  if (captureConfig.tabId !== undefined && details.tabId !== captureConfig.tabId) return
  if (!matchesUrlFilter(details.url)) return
  
  if (capturedRequests.size >= captureConfig.maxRequests) {
    const oldest = capturedRequests.keys().next().value
    if (oldest) capturedRequests.delete(oldest)
  }
  
  capturedRequests.set(details.requestId, {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    tabId: details.tabId,
    startTime: details.timeStamp
  })
}

function onSendHeaders(details) {
  if (!captureConfig.enabled) return
  const request = capturedRequests.get(details.requestId)
  if (request) {
    request.requestHeaders = redactHeaders(details.requestHeaders)
  }
}

function onHeadersReceived(details) {
  if (!captureConfig.enabled) return
  const request = capturedRequests.get(details.requestId)
  if (request) {
    request.responseHeaders = redactHeaders(details.responseHeaders)
    request.statusCode = details.statusCode
    request.statusLine = details.statusLine
  }
}

function onCompleted(details) {
  if (!captureConfig.enabled) return
  const request = capturedRequests.get(details.requestId)
  if (request) {
    request.fromCache = details.fromCache
    request.endTime = details.timeStamp
    request.durationMs = details.timeStamp - request.startTime
  }
}

function onErrorOccurred(details) {
  if (!captureConfig.enabled) return
  const request = capturedRequests.get(details.requestId)
  if (request) {
    request.error = details.error
    request.endTime = details.timeStamp
    request.durationMs = details.timeStamp - request.startTime
  }
}

function registerNetworkListeners() {
  if (networkListenersRegistered) return
  const filter = { urls: ['<all_urls>'] }
  
  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter)
  chrome.webRequest.onSendHeaders.addListener(onSendHeaders, filter, ['requestHeaders'])
  chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, filter, ['responseHeaders'])
  chrome.webRequest.onCompleted.addListener(onCompleted, filter)
  chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, filter)
  
  networkListenersRegistered = true
}

function unregisterNetworkListeners() {
  if (!networkListenersRegistered) return
  
  chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest)
  chrome.webRequest.onSendHeaders.removeListener(onSendHeaders)
  chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived)
  chrome.webRequest.onCompleted.removeListener(onCompleted)
  chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred)
  
  networkListenersRegistered = false
}

function handleEnableNetworkCapture(message) {
  captureConfig = {
    enabled: true,
    tabId: message.tabId,
    urlFilter: message.urlFilter,
    maxRequests: message.maxRequests || 1000,
    redactHeaders: message.redactHeaders || ['authorization', 'cookie', 'set-cookie', 'x-auth-token']
  }
  registerNetworkListeners()
  sendToWebSocket({
    type: 'browser-enable-network-capture-result',
    requestId: message.requestId,
    success: true,
    config: { tabId: captureConfig.tabId, maxRequests: captureConfig.maxRequests }
  })
}

function handleDisableNetworkCapture(message) {
  captureConfig.enabled = false
  unregisterNetworkListeners()
  sendToWebSocket({
    type: 'browser-disable-network-capture-result',
    requestId: message.requestId,
    success: true
  })
}

function handleGetNetworkRequests(message) {
  let requests = Array.from(capturedRequests.values())
  
  if (message.tabId !== undefined) {
    requests = requests.filter(r => r.tabId === message.tabId)
  }
  if (message.type) {
    requests = requests.filter(r => r.type === message.type)
  }
  if (message.urlPattern) {
    try {
      const regex = new RegExp(message.urlPattern, 'i')
      requests = requests.filter(r => regex.test(r.url))
    } catch {}
  }
  
  requests.sort((a, b) => b.startTime - a.startTime)
  
  const offset = message.offset || 0
  const limit = message.limit || 100
  const total = requests.length
  const paginated = requests.slice(offset, offset + limit)
  
  sendToWebSocket({
    type: 'browser-get-network-requests-result',
    requestId: message.requestId,
    success: true,
    total,
    offset,
    limit,
    requests: paginated
  })
}

function handleClearNetworkRequests(message) {
  if (message.tabId !== undefined) {
    for (const [id, req] of capturedRequests) {
      if (req.tabId === message.tabId) {
        capturedRequests.delete(id)
      }
    }
  } else {
    capturedRequests.clear()
  }
  sendToWebSocket({
    type: 'browser-clear-network-requests-result',
    requestId: message.requestId,
    success: true,
    remaining: capturedRequests.size
  })
}

// =============================================================================
// TABS & SCREENSHOTS
// =============================================================================

async function handleListTabs(message) {
  try {
    const tabs = await chrome.tabs.query({})
    const tabList = tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
      windowId: t.windowId,
      index: t.index
    }))
    
    sendToWebSocket({
      type: 'browser-list-tabs-result',
      requestId: message.requestId,
      success: true,
      tabs: tabList
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-list-tabs-result',
      requestId: message.requestId,
      success: false,
      error: err.message
    })
  }
}

async function handleScreenshot(message) {
  try {
    const tabId = message.tabId
    const fullPage = message.fullPage || false
    
    // Remember original tab to return to
    const [originalTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const originalTabId = originalTab?.id
    const originalWindowId = originalTab?.windowId
    
    // Get target tab
    const targetTabId = tabId || originalTabId
    
    // If tabId specified, switch to that tab first
    if (tabId && tabId !== originalTabId) {
      const tab = await chrome.tabs.get(tabId)
      await chrome.tabs.update(tabId, { active: true })
      await chrome.windows.update(tab.windowId, { focused: true })
      // Small delay for tab to render
      await new Promise(r => setTimeout(r, 150))
    }
    
    let dataUrl
    
    if (fullPage) {
      // Use Debugger API for full page screenshot
      dataUrl = await captureFullPage(targetTabId)
    } else {
      // Standard viewport capture
      dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' })
    }
    
    // Return to original tab (likely Ona/Gitpod tab)
    if (tabId && tabId !== originalTabId && originalTabId) {
      await chrome.tabs.update(originalTabId, { active: true })
      if (originalWindowId) {
        await chrome.windows.update(originalWindowId, { focused: true })
      }
    }
    
    sendToWebSocket({
      type: 'browser-screenshot-result',
      requestId: message.requestId,
      success: true,
      dataUrl
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-screenshot-result',
      requestId: message.requestId,
      success: false,
      error: err.message
    })
  }
}

/**
 * Capture full page screenshot using Chrome Debugger API
 */
async function captureFullPage(tabId) {
  const debugTarget = { tabId }
  
  try {
    // Attach debugger
    await chrome.debugger.attach(debugTarget, '1.3')
    
    // Get page metrics
    const metrics = await chrome.debugger.sendCommand(debugTarget, 'Page.getLayoutMetrics')
    
    // Get full page dimensions
    const width = Math.ceil(metrics.contentSize.width)
    const height = Math.ceil(metrics.contentSize.height)
    
    // Set device metrics to full page size
    await chrome.debugger.sendCommand(debugTarget, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    
    // Small delay for render
    await new Promise(r => setTimeout(r, 100))
    
    // Capture screenshot
    const result = await chrome.debugger.sendCommand(debugTarget, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    })
    
    // Clear device metrics override
    await chrome.debugger.sendCommand(debugTarget, 'Emulation.clearDeviceMetricsOverride')
    
    // Detach debugger
    await chrome.debugger.detach(debugTarget)
    
    return `data:image/png;base64,${result.data}`
  } catch (err) {
    // Make sure to detach on error
    try {
      await chrome.debugger.detach(debugTarget)
    } catch {}
    throw err
  }
}

// =============================================================================
// ELEMENTS INSPECTION
// =============================================================================

async function getTargetTabId(tabId) {
  if (tabId !== undefined) return tabId
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id) throw new Error('No active tab found')
  return activeTab.id
}

async function handleGetElementInfo(message) {
  try {
    const tabId = await getTargetTabId(message.tabId)
    
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector, includeStyles) => {
        const element = document.querySelector(selector)
        if (!element) return null
        
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        
        const attributes = {}
        for (const attr of element.attributes) {
          attributes[attr.name] = attr.value
        }
        
        const isVisible = style.display !== 'none' && 
                          style.visibility !== 'hidden' && 
                          style.opacity !== '0' &&
                          rect.width > 0 && rect.height > 0
        
        let computedStyles
        if (includeStyles) {
          const props = ['display', 'position', 'width', 'height', 'color', 'backgroundColor', 'fontSize']
          computedStyles = {}
          for (const prop of props) {
            computedStyles[prop] = style.getPropertyValue(prop) || ''
          }
        }
        
        let innerHTML = element.innerHTML
        let outerHTML = element.outerHTML
        if (innerHTML.length > 5000) innerHTML = innerHTML.substring(0, 5000) + '...'
        if (outerHTML.length > 5000) outerHTML = outerHTML.substring(0, 5000) + '...'
        
        return {
          tagName: element.tagName.toLowerCase(),
          id: element.id || undefined,
          className: element.className || undefined,
          attributes,
          innerText: (element.innerText || '').substring(0, 1000),
          innerHTML,
          outerHTML,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          computedStyles,
          isVisible,
          childCount: element.children.length
        }
      },
      args: [message.selector, message.includeStyles !== false]
    })
    
    const elementInfo = results?.[0]?.result
    
    sendToWebSocket({
      type: 'browser-get-element-info-result',
      requestId: message.requestId,
      success: !!elementInfo,
      element: elementInfo,
      error: elementInfo ? undefined : `Element not found: ${message.selector}`
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-get-element-info-result',
      requestId: message.requestId,
      success: false,
      error: err.message
    })
  }
}

async function handleClickElement(message) {
  try {
    const tabId = await getTargetTabId(message.tabId)
    
    // Remember original tab to return to
    const [originalTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const originalTabId = originalTab?.id
    const originalWindowId = originalTab?.windowId
    const needsSwitch = tabId !== originalTabId
    
    // Switch to target tab if needed
    if (needsSwitch) {
      const tab = await chrome.tabs.get(tabId)
      await chrome.tabs.update(tabId, { active: true })
      await chrome.windows.update(tab.windowId, { focused: true })
      await new Promise(r => setTimeout(r, 100))
    }
    
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector) => {
        const element = document.querySelector(selector)
        if (!element) return { success: false, error: `Element not found: ${selector}` }
        
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        
        if (style.display === 'none' || style.visibility === 'hidden') {
          return { success: false, error: 'Element is not visible' }
        }
        if (rect.width === 0 || rect.height === 0) {
          return { success: false, error: 'Element has no dimensions' }
        }
        
        element.scrollIntoView({ behavior: 'instant', block: 'center' })
        element.click()
        return { success: true }
      },
      args: [message.selector]
    })
    
    const result = results?.[0]?.result || { success: false, error: 'Script failed' }
    
    // Return to original tab unless returnToOriginal is explicitly false
    if (needsSwitch && message.returnToOriginal !== false && originalTabId) {
      // Small delay to let click action complete
      await new Promise(r => setTimeout(r, 200))
      await chrome.tabs.update(originalTabId, { active: true })
      if (originalWindowId) {
        await chrome.windows.update(originalWindowId, { focused: true })
      }
    }
    
    sendToWebSocket({
      type: 'browser-click-element-result',
      requestId: message.requestId,
      ...result
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-click-element-result',
      requestId: message.requestId,
      success: false,
      error: err.message
    })
  }
}

async function handleFillInput(message) {
  try {
    const tabId = await getTargetTabId(message.tabId)
    
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector, value) => {
        const element = document.querySelector(selector)
        if (!element) return { success: false, error: `Element not found: ${selector}` }
        
        const tagName = element.tagName.toLowerCase()
        if (tagName !== 'input' && tagName !== 'textarea' && !element.isContentEditable) {
          return { success: false, error: `Element is not fillable: ${tagName}` }
        }
        
        element.focus()
        if (element.isContentEditable) {
          element.textContent = value
        } else {
          element.value = value
        }
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        return { success: true }
      },
      args: [message.selector, message.value]
    })
    
    const result = results?.[0]?.result || { success: false, error: 'Script failed' }
    sendToWebSocket({
      type: 'browser-fill-input-result',
      requestId: message.requestId,
      ...result
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-fill-input-result',
      requestId: message.requestId,
      success: false,
      error: err.message
    })
  }
}

// =============================================================================
// ELEMENT PICKER
// =============================================================================

/**
 * Inject picker script into active tab
 */
async function injectPicker() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      console.error('[Background] No active tab found')
      return
    }

    // Skip restricted URLs
    if (tab.url?.startsWith('chrome://') || 
        tab.url?.startsWith('chrome-extension://') ||
        tab.url?.startsWith('edge://') ||
        tab.url?.startsWith('about:')) {
      console.log('[Background] Cannot inject into restricted URL:', tab.url)
      return
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['picker.js']
    })
    console.log('[Background] Picker injected into tab:', tab.id)
  } catch (err) {
    console.error('[Background] Failed to inject picker:', err)
  }
}

/**
 * Handle element selection from picker
 */
function handleElementSelected(element, sender) {
  console.log('[Background] Element selected:', element.selector)
  
  // Add tab info
  element.tabId = sender.tab?.id
  
  // Send to backend via WebSocket
  sendToWebSocket({
    type: 'element-selected',
    element
  })
}

// =============================================================================
// INITIALIZATION
// =============================================================================

console.log('[Background] Oko service worker starting')

// Listen for storage changes to clear connection cache
chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === 'sync' && changes.backendUrl) || 
      (areaName === 'local' && changes.authToken)) {
    console.log('[Background] Connection settings changed, reconnecting...')
    if (ws) {
      ws.close()
    }
    connectWebSocket()
  }
})

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_WS_RECONNECT) {
    console.log('[Background] Reconnect alarm fired')
    connectWebSocket()
  }
})

// Handle extension page connections
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Background] Client connected:', port.name)
  connectedClients.add(port)

  port.onDisconnect.addListener(() => {
    console.log('[Background] Client disconnected:', port.name)
    connectedClients.delete(port)
  })

  port.onMessage.addListener((message) => {
    if (message.type === 'GET_CONNECTION_STATUS') {
      port.postMessage({
        type: 'CONNECTION_STATUS',
        connected: ws?.readyState === WebSocket.OPEN
      })
    } else if (message.type === 'RECONNECT') {
      connectWebSocket()
    }
  })
})

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason)
})

// Handle keyboard shortcut commands
chrome.commands.onCommand.addListener((command) => {
  console.log('[Background] Command received:', command)
  if (command === 'toggle-picker') {
    injectPicker()
  }
})

// Handle messages from content scripts (picker)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ELEMENT_SELECTED') {
    handleElementSelected(message.element, sender)
    sendResponse({ success: true })
  }
  return true // Keep channel open for async response
})

// Keep service worker alive
chrome.alarms.create('keepalive', { periodInMinutes: 1 })

// Connect to backend
connectWebSocket()

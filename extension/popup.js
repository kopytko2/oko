const backendUrlInput = document.getElementById('backendUrl')
const authTokenInput = document.getElementById('authToken')
const testBtn = document.getElementById('testBtn')
const saveBtn = document.getElementById('saveBtn')
const statusDiv = document.getElementById('status')
const pickerBtn = document.getElementById('pickerBtn')
const shortcutKey = document.getElementById('shortcutKey')
const quickConfigInput = document.getElementById('quickConfig')
const statusDot = document.getElementById('statusDot')
const statusText = document.getElementById('statusText')
const collapseBtn = document.getElementById('collapseBtn')
const connectionBody = document.getElementById('connectionBody')
const connectionCard = document.getElementById('connectionCard')
const disconnectBtn = document.getElementById('disconnectBtn')
const reconnectBtn = document.getElementById('reconnectBtn')

let originalUrl = ''
let originalToken = ''

const isMac = navigator.platform.toUpperCase().includes('MAC')
const shortcutModifier = isMac ? 'option' : 'alt'
shortcutKey.textContent = `${shortcutModifier} + shift + A`

// =============================================================================
// UI STATE MANAGEMENT
// =============================================================================

function setConnectionCollapsed(collapsed) {
  connectionBody.classList.toggle('collapsed', collapsed)
  collapseBtn.textContent = collapsed ? 'Show' : 'Hide'
}

function setDisconnectVisible(visible) {
  disconnectBtn.classList.toggle('hidden', !visible)
}

function setConnectionState(state, options = {}) {
  const { autoCollapse = false } = options

  if (state === 'connected') {
    statusDot.className = 'status-dot connected'
    statusText.textContent = 'Connected'
    connectionCard.classList.add('connected')
    setDisconnectVisible(true)
    if (autoCollapse) {
      setConnectionCollapsed(true)
    }
    return
  }

  if (state === 'offline') {
    statusDot.className = 'status-dot offline'
    statusText.textContent = 'Offline'
    connectionCard.classList.remove('connected')
    setDisconnectVisible(false)
    if (autoCollapse) {
      setConnectionCollapsed(false)
    }
  }
}

function showStatus(type, message) {
  statusDiv.className = `status-msg ${type} visible`
  statusDiv.textContent = message
  
  if (type === 'success' && message.includes('Connected')) {
    setConnectionState('connected', { autoCollapse: true })
  } else if (type === 'error' && !message.includes('Disconnected')) {
    // Don't change state for manual disconnect
  }
}

// =============================================================================
// CONNECTION CODE PARSING
// =============================================================================

/**
 * Parse connection code format: oko:BASE64(url|token)
 */
function parseConnectionCode(text) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('oko:')) return null
  
  try {
    const base64 = trimmed.slice(4)
    const decoded = atob(base64)
    const pipeIndex = decoded.indexOf('|')
    if (pipeIndex === -1) return null
    
    const url = decoded.slice(0, pipeIndex)
    const token = decoded.slice(pipeIndex + 1)
    
    if (!url || !token) return null
    return { url, token }
  } catch {
    return null
  }
}

/**
 * Parse config text to extract URL and token
 * Supports: connection code, JSON, key-value pairs, raw URL+token
 */
function parseConfig(text) {
  const result = { url: null, token: null }
  
  if (!text || !text.trim()) return result
  
  // Try connection code format first (oko:BASE64)
  const codeResult = parseConnectionCode(text)
  if (codeResult) {
    return codeResult
  }
  
  // Try JSON format
  try {
    const json = JSON.parse(text)
    if (json.url) result.url = json.url
    if (json.token) result.token = json.token
    if (json.backendUrl) result.url = json.backendUrl
    if (json.authToken) result.token = json.authToken
    if (result.url || result.token) return result
  } catch {}
  
  // Look for URL patterns
  const urlPatterns = [
    /(?:url|backend|endpoint)[:\s=]+["']?(https?:\/\/[^\s"']+)/i,
    /(https?:\/\/\d+--[^\s]+\.gitpod\.(?:dev|io)[^\s]*)/i,
    /(https?:\/\/[^\s]+:\d+)/,
    /(https?:\/\/localhost[^\s]*)/i
  ]
  
  for (const pattern of urlPatterns) {
    const match = text.match(pattern)
    if (match) {
      result.url = match[1].replace(/['"]+$/, '')
      break
    }
  }
  
  // Look for token patterns
  const tokenPatterns = [
    /(?:token|auth|key|secret)[:\s=]+["']?([a-zA-Z0-9_-]{16,})/i,
    /^([a-f0-9]{32,64})$/im
  ]
  
  for (const pattern of tokenPatterns) {
    const match = text.match(pattern)
    if (match) {
      result.token = match[1].replace(/['"]+$/, '')
      break
    }
  }
  
  return result
}

// =============================================================================
// CONNECTION MANAGEMENT
// =============================================================================

async function saveAndConnect(url, token) {
  // Save to storage
  await Promise.all([
    chrome.storage.sync.set({ backendUrl: url }),
    chrome.storage.local.set({ authToken: token })
  ])
  
  // Update form state
  backendUrlInput.value = url
  authTokenInput.value = token
  originalUrl = url
  originalToken = token
  saveBtn.disabled = true
  
  // Trigger reconnect in background
  try {
    await chrome.runtime.sendMessage({ type: 'RECONNECT' })
  } catch {}
  
  // Test and show status
  await testConnection()
}

async function refreshConnectionStatus() {
  // First check WebSocket status from background
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' })
    if (response?.connected) {
      setConnectionState('connected', { autoCollapse: true })
      return
    }
  } catch {}
  
  // Fall back to HTTP health check
  const url = backendUrlInput.value.trim() || 'http://localhost:8129'
  const token = authTokenInput.value.trim()
  const headers = {}
  if (token) headers['X-Auth-Token'] = token

  try {
    const response = await fetch(`${url}/api/health`, {
      headers,
      signal: AbortSignal.timeout(3000)
    })
    if (response.ok) {
      setConnectionState('connected', { autoCollapse: true })
    } else {
      setConnectionState('offline', { autoCollapse: true })
    }
  } catch {
    setConnectionState('offline', { autoCollapse: true })
  }
}

async function testConnection() {
  const url = backendUrlInput.value.trim() || 'http://localhost:8129'
  const token = authTokenInput.value.trim()
  
  showStatus('testing', 'Testing connection...')
  
  try {
    const headers = {}
    if (token) headers['X-Auth-Token'] = token
    
    const start = Date.now()
    const response = await fetch(`${url}/api/health`, {
      headers,
      signal: AbortSignal.timeout(5000)
    })
    const latency = Date.now() - start
    
    if (response.ok) {
      showStatus('success', `Connected (${latency}ms)`)
      setConnectionState('connected', { autoCollapse: true })
    } else if (response.status === 401 || response.status === 403) {
      showStatus('error', 'Auth failed - check token')
      setConnectionState('offline')
    } else {
      showStatus('error', `HTTP ${response.status}`)
      setConnectionState('offline')
    }
  } catch (err) {
    if (err.name === 'TimeoutError') {
      showStatus('error', 'Connection timed out')
    } else {
      showStatus('error', 'Cannot reach server')
    }
    setConnectionState('offline')
  }
}

async function saveSettings() {
  const url = backendUrlInput.value.trim() || 'http://localhost:8129'
  const token = authTokenInput.value.trim()
  
  await Promise.all([
    chrome.storage.sync.set({ backendUrl: url }),
    chrome.storage.local.set({ authToken: token })
  ])
  
  originalUrl = url
  originalToken = token
  saveBtn.disabled = true
  
  // Trigger reconnect
  try {
    await chrome.runtime.sendMessage({ type: 'RECONNECT' })
  } catch {}
  
  showStatus('success', 'Settings saved')
}

// =============================================================================
// AUTO-DETECT LOCAL BACKEND
// =============================================================================

async function autoDetectLocalBackend() {
  // Only auto-detect if no URL is configured or it's the default
  const currentUrl = backendUrlInput.value.trim()
  if (currentUrl && currentUrl !== 'http://localhost:8129') {
    return false
  }
  
  try {
    const response = await fetch('http://localhost:8129/api/health', {
      signal: AbortSignal.timeout(1000)
    })
    if (response.ok) {
      backendUrlInput.value = 'http://localhost:8129'
      authTokenInput.value = '' // Local doesn't need token
      showStatus('success', 'Local backend detected')
      setConnectionState('connected', { autoCollapse: true })
      return true
    }
  } catch {}
  
  return false
}

// =============================================================================
// INITIALIZATION
// =============================================================================

async function loadSettings() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(['backendUrl']),
    chrome.storage.local.get(['authToken'])
  ])
  
  backendUrlInput.value = syncData.backendUrl || 'http://localhost:8129'
  authTokenInput.value = localData.authToken || ''
  
  originalUrl = backendUrlInput.value
  originalToken = authTokenInput.value

  // Try auto-detect first, then check saved connection
  const detected = await autoDetectLocalBackend()
  if (!detected) {
    await refreshConnectionStatus()
  }
}

function checkDirty() {
  const isDirty = backendUrlInput.value !== originalUrl || authTokenInput.value !== originalToken
  saveBtn.disabled = !isDirty
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

// Collapse functionality
collapseBtn.addEventListener('click', () => {
  const collapsed = !connectionBody.classList.contains('collapsed')
  setConnectionCollapsed(collapsed)
})

// Disconnect button
disconnectBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'DISCONNECT' })
  } catch {}
  showStatus('error', 'Disconnected')
  setConnectionState('offline', { autoCollapse: false })
})

// Reconnect button
reconnectBtn.addEventListener('click', async () => {
  showStatus('testing', 'Reconnecting...')
  try {
    await chrome.runtime.sendMessage({ type: 'RECONNECT' })
    // Wait a moment for connection to establish
    await new Promise(resolve => setTimeout(resolve, 500))
    await testConnection()
  } catch {
    showStatus('error', 'Reconnect failed')
  }
})

// Quick config paste - now auto-saves and connects
quickConfigInput.addEventListener('input', async () => {
  const text = quickConfigInput.value
  const parsed = parseConfig(text)
  
  if (parsed.url && parsed.token) {
    // Clear input immediately
    quickConfigInput.value = ''
    showStatus('testing', 'Connecting...')
    
    // Auto-save and connect
    await saveAndConnect(parsed.url, parsed.token)
  } else if (parsed.url || parsed.token) {
    // Partial match - fill fields but don't auto-connect
    if (parsed.url) backendUrlInput.value = parsed.url
    if (parsed.token) authTokenInput.value = parsed.token
    checkDirty()
    
    setTimeout(() => {
      quickConfigInput.value = ''
      showStatus('success', `Detected: ${parsed.url ? 'URL' : ''}${parsed.url && parsed.token ? ' + ' : ''}${parsed.token ? 'Token' : ''}`)
    }, 100)
  }
})

// Element picker button
pickerBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  
  if (!tab?.id) {
    showStatus('error', 'No active tab')
    return
  }
  
  if (tab.url?.startsWith('chrome://') || 
      tab.url?.startsWith('chrome-extension://') ||
      tab.url?.startsWith('edge://')) {
    showStatus('error', 'Cannot select on this page')
    return
  }
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['picker.js']
    })
    window.close()
  } catch (err) {
    showStatus('error', 'Failed to start picker')
  }
})

// Form inputs
backendUrlInput.addEventListener('input', checkDirty)
authTokenInput.addEventListener('input', checkDirty)
testBtn.addEventListener('click', testConnection)
saveBtn.addEventListener('click', saveSettings)

// Initialize
loadSettings()

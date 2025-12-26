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

let originalUrl = ''
let originalToken = ''

const isMac = navigator.platform.toUpperCase().includes('MAC')
const shortcutModifier = isMac ? 'option' : 'alt'
shortcutKey.textContent = `${shortcutModifier} + shift + A`

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

// Collapse functionality
collapseBtn.addEventListener('click', () => {
  const collapsed = !connectionBody.classList.contains('collapsed')
  setConnectionCollapsed(collapsed)
})

disconnectBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'DISCONNECT' })
  } catch {}
  showStatus('error', 'Disconnected')
  setConnectionState('offline', { autoCollapse: true })
})

// Smart paste detection for quick config
quickConfigInput.addEventListener('input', () => {
  const text = quickConfigInput.value
  const parsed = parseConfig(text)
  
  if (parsed.url) {
    backendUrlInput.value = parsed.url
  }
  if (parsed.token) {
    authTokenInput.value = parsed.token
  }
  
  if (parsed.url || parsed.token) {
    checkDirty()
    // Clear the textarea after successful parse
    setTimeout(() => {
      quickConfigInput.value = ''
      showStatus('success', `Detected: ${parsed.url ? 'URL' : ''}${parsed.url && parsed.token ? ' + ' : ''}${parsed.token ? 'Token' : ''}`)
    }, 100)
  }
})

/**
 * Parse config text to extract URL and token
 * Supports formats:
 * - URL: https://... \n Token: abc123
 * - url=https://... token=abc123
 * - https://... on one line, token on another
 * - JSON: {"url": "...", "token": "..."}
 */
function parseConfig(text) {
  const result = { url: null, token: null }
  
  if (!text || !text.trim()) return result
  
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
    /(?:url|backend|endpoint)[:\s=]+["']?([^\s"']+\.gitpod\.(?:dev|io)[^\s"']*)/i,
    /(https?:\/\/\d+--[^\s]+\.gitpod\.(?:dev|io)[^\s]*)/i,
    /(https?:\/\/[^\s]+:\d+)/,
    /(https?:\/\/localhost[^\s]*)/i
  ]
  
  for (const pattern of urlPatterns) {
    const match = text.match(pattern)
    if (match) {
      result.url = match[1].replace(/['"]+$/, '') // Strip trailing quotes
      break
    }
  }
  
  // Look for token patterns
  const tokenPatterns = [
    /(?:token|auth|key|secret)[:\s=]+["']?([a-zA-Z0-9_-]{16,})/i,
    /OKO_AUTH_TOKEN[=:\s]+["']?([a-zA-Z0-9_-]+)/i,
    /^([a-f0-9]{32,64})$/im // Hex token on its own line
  ]
  
  for (const pattern of tokenPatterns) {
    const match = text.match(pattern)
    if (match) {
      result.token = match[1].replace(/['"]+$/, '')
      break
    }
  }
  
  // If we found a URL but no token, check for a standalone token-like string
  if (result.url && !result.token) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l)
    for (const line of lines) {
      // Skip the line with URL
      if (line.includes(result.url)) continue
      // Check if line looks like a token (alphanumeric, 16+ chars, no spaces)
      if (/^[a-zA-Z0-9_-]{16,}$/.test(line)) {
        result.token = line
        break
      }
    }
  }
  
  return result
}

// Element picker button
pickerBtn.addEventListener('click', async () => {
  // Get active tab and inject picker
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  
  if (!tab?.id) {
    showStatus('error', 'No active tab')
    return
  }
  
  // Check for restricted URLs
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
    // Close popup after injecting
    window.close()
  } catch (err) {
    showStatus('error', 'Failed to start picker')
  }
})

// Load saved settings
async function loadSettings() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(['backendUrl']),
    chrome.storage.local.get(['authToken'])
  ])
  
  backendUrlInput.value = syncData.backendUrl || 'http://localhost:8129'
  authTokenInput.value = localData.authToken || ''
  
  originalUrl = backendUrlInput.value
  originalToken = authTokenInput.value

  refreshConnectionStatus()
}

// Check if settings changed
function checkDirty() {
  const isDirty = backendUrlInput.value !== originalUrl || authTokenInput.value !== originalToken
  saveBtn.disabled = !isDirty
}

// Show status message
function showStatus(type, message) {
  statusDiv.className = `status-msg ${type} visible`
  statusDiv.textContent = message
  
  // Update header status pill
  if (type === 'success' && message.includes('Connected')) {
    setConnectionState('connected', { autoCollapse: true })
  } else if (type === 'error') {
    setConnectionState('offline', { autoCollapse: true })
  }
}

async function refreshConnectionStatus() {
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

// Test connection
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
    } else if (response.status === 401 || response.status === 403) {
      showStatus('error', 'Auth failed - check token')
    } else {
      showStatus('error', `HTTP ${response.status}`)
    }
  } catch (err) {
    if (err.name === 'TimeoutError') {
      showStatus('error', 'Connection timed out')
    } else {
      showStatus('error', 'Cannot reach server')
    }
  }
}

// Save settings
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
  
  showStatus('success', 'Settings saved')
}

// Event listeners
backendUrlInput.addEventListener('input', checkDirty)
authTokenInput.addEventListener('input', checkDirty)
testBtn.addEventListener('click', testConnection)
saveBtn.addEventListener('click', saveSettings)

// Initialize
loadSettings()

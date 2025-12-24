const backendUrlInput = document.getElementById('backendUrl')
const authTokenInput = document.getElementById('authToken')
const testBtn = document.getElementById('testBtn')
const saveBtn = document.getElementById('saveBtn')
const statusDiv = document.getElementById('status')

let originalUrl = ''
let originalToken = ''

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
}

// Check if settings changed
function checkDirty() {
  const isDirty = backendUrlInput.value !== originalUrl || authTokenInput.value !== originalToken
  saveBtn.disabled = !isDirty
}

// Show status message
function showStatus(type, message) {
  statusDiv.className = `status ${type}`
  statusDiv.textContent = message
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

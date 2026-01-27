/**
 * Oko Backend Server
 * Provides browser automation APIs for Ona environments
 */

const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const http = require('http')
const WebSocket = require('ws')
const crypto = require('crypto')
const fs = require('fs')

// =============================================================================
// CONFIGURATION
// =============================================================================

const PORT = process.env.PORT || 8129
const WS_AUTH_TOKEN_FILE = '/tmp/oko-auth-token'

// Auth token: use environment variable for remote, generate random for local
const WS_AUTH_TOKEN = process.env.OKO_AUTH_TOKEN || crypto.randomBytes(32).toString('hex')

// Token expiry: 24 hours from server start (configurable via env)
const TOKEN_EXPIRY_MS = parseInt(process.env.OKO_TOKEN_EXPIRY_HOURS || '24', 10) * 60 * 60 * 1000
const TOKEN_CREATED_AT = Date.now()

function isTokenExpired() {
  return Date.now() - TOKEN_CREATED_AT > TOKEN_EXPIRY_MS
}
const EXTENSION_REQUEST_TIMEOUT_MS = 10000
const EXTENSION_FULL_PAGE_TIMEOUT_MS = 30000

// Write token to file for local development (extension can read it)
if (!process.env.OKO_AUTH_TOKEN) {
  try {
    fs.writeFileSync(WS_AUTH_TOKEN_FILE, WS_AUTH_TOKEN, { mode: 0o600 })
    console.log(`[Auth] Token written to ${WS_AUTH_TOKEN_FILE}`)
  } catch (err) {
    console.error(`[Auth] Failed to write token file: ${err.message}`)
  }
} else {
  console.log('[Auth] Using OKO_AUTH_TOKEN from environment')
}

// =============================================================================
// EXPRESS APP
// =============================================================================

const app = express()
const server = http.createServer(app)

// JSON body parser
app.use(express.json())

// =============================================================================
// CORS CONFIGURATION
// =============================================================================

// Handle Private Network Access preflight BEFORE cors() (Chrome 94+)
// Must be before cors() because cors() ends OPTIONS responses
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  next()
})

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, etc.)
    if (!origin) {
      return callback(null, true)
    }

    // Allow Chrome extensions
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true)
    }

    // Allow Gitpod/Ona URLs
    if (origin.match(/\.gitpod\.(dev|io)$/)) {
      return callback(null, true)
    }

    // Allow localhost (exact match to prevent localhost.attacker)
    if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
      return callback(null, true)
    }

    // Reject other origins
    console.warn(`[CORS] Rejected origin: ${origin}`)
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true
}

app.use(cors(corsOptions))

// =============================================================================
// RATE LIMITING
// =============================================================================

// Rate limit for browser API endpoints (prevents abuse)
const browserApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded',
    message: 'Too many requests. Maximum 100 per minute.',
    retryAfter: 60
  },
  keyGenerator: (req) => {
    return req.ip || req.socket?.remoteAddress || 'unknown'
  }
})

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

/**
 * Check if request is from localhost using socket address (not spoofable Host header)
 */
function isLocalRequest(req) {
  const remoteAddr = req.socket?.remoteAddress || req.ip || ''
  // IPv4 localhost or IPv6 localhost
  return remoteAddr === '127.0.0.1' || 
         remoteAddr === '::1' || 
         remoteAddr === '::ffff:127.0.0.1'
}

/**
 * Validate auth token from header or query param
 * Returns true if valid, false otherwise
 */
function validateToken(req) {
  const token = req.headers['x-auth-token'] || req.query.token
  
  // For localhost, allow unauthenticated requests if no env token is set
  if (!process.env.OKO_AUTH_TOKEN && isLocalRequest(req)) {
    return { valid: true }
  }
  
  if (token !== WS_AUTH_TOKEN) {
    return { valid: false, reason: 'invalid' }
  }
  
  if (isTokenExpired()) {
    return { valid: false, reason: 'expired' }
  }
  
  return { valid: true }
}

/**
 * Auth middleware for protected routes
 */
function requireAuth(req, res, next) {
  const result = validateToken(req)
  if (!result.valid) {
    const message = result.reason === 'expired' 
      ? 'Token expired. Restart the backend to generate a new token.'
      : 'Invalid or missing auth token'
    return res.status(401).json({
      error: 'Unauthorized',
      message,
      reason: result.reason
    })
  }
  next()
}

// =============================================================================
// HEALTH & AUTH ENDPOINTS
// =============================================================================

/**
 * Health check endpoint - no auth required
 * Used by extension to test connectivity
 */
app.get('/api/health', (req, res) => {
  const tokenExpiresAt = TOKEN_CREATED_AT + TOKEN_EXPIRY_MS
  const tokenExpiresIn = Math.max(0, tokenExpiresAt - Date.now())
  
  res.json({
    status: isTokenExpired() ? 'token_expired' : 'ok',
    timestamp: Date.now(),
    version: '0.1.0',
    tokenExpiresIn: Math.floor(tokenExpiresIn / 1000),
    tokenExpiresAt: new Date(tokenExpiresAt).toISOString()
  })
})

/**
 * Auth token endpoint
 * Returns the session token for WebSocket authentication
 * Requires existing auth for remote connections
 */
app.get('/api/auth/token', (req, res) => {
  // For localhost without env token, return token freely
  if (!process.env.OKO_AUTH_TOKEN && isLocalRequest(req)) {
    return res.json({ token: WS_AUTH_TOKEN })
  }
  
  // For remote, require auth header
  const result = validateToken(req)
  if (!result.valid) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Auth token required for remote access',
      reason: result.reason
    })
  }
  
  res.json({ token: WS_AUTH_TOKEN })
})

// =============================================================================
// BROWSER API ROUTES (Protected)
// =============================================================================

// Browser API routes - protected and rate limited
app.use('/api/browser', requireAuth, browserApiLimiter)

// Pending requests waiting for extension response
const pendingRequests = new Map()

// Selected elements per session (scoped by auth token)
const selectedElements = new Map()
const SELECTION_TTL_MS = 5 * 60 * 1000

/**
 * Get session ID from auth token (for per-user scoping)
 */
function getSessionId(req) {
  const token = req.headers['x-auth-token'] || ''
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/**
 * Get session key for selected elements and extension targeting
 */
function getSelectionKey(req) {
  // For localhost without OKO_AUTH_TOKEN env var, always use __local__
  // This matches WS behavior and ignores any token the client might send
  if (!process.env.OKO_AUTH_TOKEN && isLocalRequest(req)) {
    return '__local__'
  }
  const token = req.headers['x-auth-token'] || req.query.token || ''
  return token || '__local__'
}

function parseInteger(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return null
}

function parseString(value, maxLength) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (maxLength && trimmed.length > maxLength) return null
  return trimmed
}

function parseStringArray(value, maxLength) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const parsed = []
  for (const item of value) {
    const entry = parseString(item, maxLength)
    if (!entry) return null
    parsed.push(entry)
  }
  return parsed
}

function getExtensionClients() {
  const extensionClients = []
  for (const [, client] of clients) {
    if (client.type === 'extension' && client.ws.readyState === WebSocket.OPEN) {
      extensionClients.push(client)
    }
  }
  return extensionClients
}

function findExtensionClient(req) {
  const extensionClients = getExtensionClients()
  if (extensionClients.length === 0) {
    return { error: { status: 503, message: 'No extension connected' } }
  }
  if (extensionClients.length === 1) {
    return { client: extensionClients[0] }
  }
  const selectionKey = getSelectionKey(req)
  const matches = extensionClients.filter(client => client.token === selectionKey)
  if (matches.length === 1) {
    return { client: matches[0] }
  }
  return { error: { status: 409, message: 'Multiple extensions connected; specify auth token' } }
}

function sendToExtension(req, res, type, payload, timeoutMs = EXTENSION_REQUEST_TIMEOUT_MS) {
  const { client, error } = findExtensionClient(req)
  if (!client) {
    res.status(error.status).json({ success: false, error: error.message })
    return null
  }

  const requestId = crypto.randomUUID()
  console.log(`[API] Sending ${type} to extension (requestId: ${requestId})`)
  try {
    client.ws.send(JSON.stringify({ type, requestId, ...payload }))
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    console.error('[WS] Failed to send message to extension:', message)
    res.status(502).json({ success: false, error: 'Failed to send request to extension' })
    return null
  }

  const timeout = setTimeout(() => {
    pendingRequests.delete(requestId)
    res.status(504).json({ success: false, error: 'Extension timeout' })
  }, timeoutMs)

  pendingRequests.set(requestId, { res, timeout })
  return requestId
}

app.get('/api/browser/tabs', async (req, res) => {
  sendToExtension(req, res, 'browser-list-tabs', {})
})

// Navigate to URL
app.post('/api/browser/navigate', async (req, res) => {
  const body = req.body || {}
  const url = parseString(body.url, 2048)
  if (!url) {
    return res.status(400).json({ success: false, error: 'url is required (max 2048 chars)' })
  }

  const tabId = parseInteger(body.tabId)
  const newTab = body.newTab === true
  const active = body.active !== false

  sendToExtension(req, res, 'browser-navigate', {
    url,
    tabId: tabId !== null && tabId >= 0 ? tabId : undefined,
    newTab,
    active
  })
})

// Get selected element for this session (scoped by auth token)
app.get('/api/browser/selected-element', requireAuth, (req, res) => {
  const key = getSelectionKey(req)
  const entry = selectedElements.get(key)
  
  // Check TTL
  if (!entry || Date.now() - entry.timestamp > SELECTION_TTL_MS) {
    if (entry) selectedElements.delete(key)
    return res.json({ success: false, error: 'No element selected (use Alt+Shift+A to pick an element)' })
  }
  
  res.json({ success: true, element: entry.element })
})

// Clear selected element for this session
app.delete('/api/browser/selected-element', requireAuth, (req, res) => {
  const key = getSelectionKey(req)
  selectedElements.delete(key)
  res.json({ success: true })
})

// Periodic cleanup of expired selections (every 5 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of selectedElements) {
    if (now - entry.timestamp > SELECTION_TTL_MS) {
      selectedElements.delete(key)
    }
  }
}, SELECTION_TTL_MS)

app.post('/api/browser/network/enable', async (req, res) => {
  const body = req.body || {}
  const tabIdValue = body.tabId
  const tabIdParsed = parseInteger(tabIdValue)
  if (tabIdValue !== undefined && (tabIdParsed === null || tabIdParsed < 0)) {
    return res.status(400).json({ success: false, error: 'tabId must be a non-negative integer' })
  }
  const tabId = tabIdValue === undefined ? undefined : tabIdParsed

  const urlFilter = parseStringArray(body.urlFilter, 1000)
  if (body.urlFilter !== undefined && !urlFilter) {
    return res.status(400).json({ success: false, error: 'urlFilter must be an array of strings' })
  }

  const maxRequestsValue = body.maxRequests
  const maxRequests = parseInteger(maxRequestsValue)
  if (maxRequestsValue !== undefined && (maxRequests === null || maxRequests <= 0)) {
    return res.status(400).json({ success: false, error: 'maxRequests must be a positive integer' })
  }

  sendToExtension(req, res, 'browser-enable-network-capture', {
    tabId,
    urlFilter,
    maxRequests
  })
})

app.post('/api/browser/network/disable', async (req, res) => {
  sendToExtension(req, res, 'browser-disable-network-capture', {})
})

app.get('/api/browser/network/requests', async (req, res) => {
  const query = req.query || {}
  const tabIdValue = query.tabId
  const tabIdParsed = parseInteger(tabIdValue)
  if (tabIdValue !== undefined && (tabIdParsed === null || tabIdParsed < 0)) {
    return res.status(400).json({ success: false, error: 'tabId must be a non-negative integer' })
  }
  const tabId = tabIdValue === undefined ? undefined : tabIdParsed

  const type = typeof query.type === 'string' ? query.type : undefined
  if (query.type !== undefined && typeof query.type !== 'string') {
    return res.status(400).json({ success: false, error: 'type must be a string' })
  }

  const urlPattern = typeof query.urlPattern === 'string' ? query.urlPattern : undefined
  if (query.urlPattern !== undefined && typeof query.urlPattern !== 'string') {
    return res.status(400).json({ success: false, error: 'urlPattern must be a string' })
  }

  const limitValue = query.limit
  const limitParsed = parseInteger(limitValue)
  if (limitValue !== undefined && (limitParsed === null || limitParsed < 1 || limitParsed > 1000)) {
    return res.status(400).json({ success: false, error: 'limit must be an integer between 1 and 1000' })
  }

  const offsetValue = query.offset
  const offsetParsed = parseInteger(offsetValue)
  if (offsetValue !== undefined && (offsetParsed === null || offsetParsed < 0)) {
    return res.status(400).json({ success: false, error: 'offset must be a non-negative integer' })
  }

  const limit = limitParsed ?? 100
  const offset = offsetParsed ?? 0

  sendToExtension(req, res, 'browser-get-network-requests', {
    tabId,
    resourceType: type,
    urlPattern,
    limit,
    offset
  })
})

// =============================================================================
// DEBUGGER-BASED NETWORK CAPTURE (with response bodies)
// =============================================================================

app.post('/api/browser/debugger/enable', async (req, res) => {
  const body = req.body || {}
  const tabId = parseInteger(body.tabId)
  if (tabId === null || tabId < 0) {
    return res.status(400).json({ success: false, error: 'tabId is required and must be a non-negative integer' })
  }

  // urlFilter: array of URL patterns to capture (regex supported)
  // If not specified, captures ALL requests from the tab
  const urlFilter = Array.isArray(body.urlFilter) ? body.urlFilter 
    : Array.isArray(body.domainFilter) ? body.domainFilter 
    : undefined
  const maxRequests = parseInteger(body.maxRequests) || 500
  // captureBody: set to false to capture headers only (safer for sensitive sites)
  const captureBody = body.captureBody !== false

  sendToExtension(req, res, 'browser-enable-debugger-capture', {
    tabId,
    urlFilter,
    maxRequests,
    captureBody
  })
})

app.post('/api/browser/debugger/disable', async (req, res) => {
  const body = req.body || {}
  const tabId = parseInteger(body.tabId)
  if (tabId === null || tabId < 0) {
    return res.status(400).json({ success: false, error: 'tabId is required and must be a non-negative integer' })
  }

  sendToExtension(req, res, 'browser-disable-debugger-capture', { tabId })
})

app.get('/api/browser/debugger/requests', async (req, res) => {
  const query = req.query || {}
  const tabId = parseInteger(query.tabId)
  if (tabId === null || tabId < 0) {
    return res.status(400).json({ success: false, error: 'tabId is required and must be a non-negative integer' })
  }

  const urlPattern = typeof query.urlPattern === 'string' ? query.urlPattern : undefined
  const resourceType = typeof query.resourceType === 'string' ? query.resourceType : undefined
  const limit = parseInteger(query.limit) || 50
  const offset = parseInteger(query.offset) || 0

  sendToExtension(req, res, 'browser-get-debugger-requests', {
    tabId,
    urlPattern,
    resourceType,
    limit,
    offset
  })
})

app.delete('/api/browser/debugger/requests', async (req, res) => {
  const query = req.query || {}
  const tabId = parseInteger(query.tabId)
  if (tabId === null || tabId < 0) {
    return res.status(400).json({ success: false, error: 'tabId is required and must be a non-negative integer' })
  }

  sendToExtension(req, res, 'browser-clear-debugger-requests', { tabId })
})

app.post('/api/browser/element-info', async (req, res) => {
  const body = req.body || {}
  const selector = parseString(body.selector, 1000)
  if (!selector) {
    return res.status(400).json({ success: false, error: 'selector required' })
  }

  const tabIdValue = body.tabId
  const tabId = parseInteger(tabIdValue)
  if (tabIdValue !== undefined && (tabId === null || tabId < 0)) {
    return res.status(400).json({ success: false, error: 'tabId must be a non-negative integer' })
  }

  let includeStyles = true
  if (body.includeStyles !== undefined) {
    if (typeof body.includeStyles !== 'boolean') {
      return res.status(400).json({ success: false, error: 'includeStyles must be a boolean' })
    }
    includeStyles = body.includeStyles
  }

  sendToExtension(req, res, 'browser-get-element-info', {
    tabId,
    selector,
    includeStyles
  })
})

app.post('/api/browser/click', async (req, res) => {
  const body = req.body || {}
  const selector = parseString(body.selector, 1000)
  if (!selector) {
    return res.status(400).json({ success: false, error: 'selector required' })
  }

  const tabIdValue = body.tabId
  const tabId = parseInteger(tabIdValue)
  if (tabIdValue !== undefined && (tabId === null || tabId < 0)) {
    return res.status(400).json({ success: false, error: 'tabId must be a non-negative integer' })
  }

  sendToExtension(req, res, 'browser-click-element', {
    tabId,
    selector
  })
})

app.get('/api/browser/screenshot', async (req, res) => {
  const query = req.query || {}
  const tabIdValue = query.tabId
  const tabId = parseInteger(tabIdValue)
  if (tabIdValue !== undefined && (tabId === null || tabId < 0)) {
    return res.status(400).json({ success: false, error: 'tabId must be a non-negative integer' })
  }

  let fullPage = false
  if (query.fullPage !== undefined) {
    if (query.fullPage === 'true' || query.fullPage === '1') {
      fullPage = true
    } else if (query.fullPage === 'false' || query.fullPage === '0') {
      fullPage = false
    } else {
      return res.status(400).json({ success: false, error: 'fullPage must be true or false' })
    }
  }

  const timeoutMs = fullPage
    ? EXTENSION_FULL_PAGE_TIMEOUT_MS
    : EXTENSION_REQUEST_TIMEOUT_MS

  sendToExtension(req, res, 'browser-screenshot', { tabId, fullPage }, timeoutMs)
})

// =============================================================================
// WEBSOCKET SERVER
// =============================================================================

const wss = new WebSocket.Server({ server })

// Track connected clients
const clients = new Map()

wss.on('connection', (ws, req) => {
  // Validate auth token
  const url = new URL(req.url, `http://localhost`)
  const token = url.searchParams.get('token') || req.headers['x-auth-token']
  
  // Check if connection is from localhost using socket address
  const remoteAddr = req.socket?.remoteAddress || ''
  const isLocal = remoteAddr === '127.0.0.1' || 
                  remoteAddr === '::1' || 
                  remoteAddr === '::ffff:127.0.0.1'
  
  // For localhost without env token, allow unauthenticated
  if (!isLocal || process.env.OKO_AUTH_TOKEN) {
    if (token !== WS_AUTH_TOKEN) {
      console.warn(`[WS] Unauthorized connection attempt from ${remoteAddr}`)
      ws.close(4001, 'Unauthorized')
      return
    }
  }
  
  const clientId = crypto.randomUUID()
  // Store token with client for session scoping
  // For localhost without OKO_AUTH_TOKEN env var, always use __local__ key
  // This ensures HTTP requests without token can still fetch selections
  const isLocalNoAuth = isLocal && !process.env.OKO_AUTH_TOKEN
  const selectionKey = isLocalNoAuth ? '__local__' : (token || clientId)
  clients.set(clientId, { ws, type: 'unknown', token: selectionKey })
  console.log(`[WS] Client connected: ${clientId}, selectionKey: ${selectionKey === '__local__' ? '__local__' : '***'}`)
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString())
      handleWebSocketMessage(clientId, message)
    } catch (err) {
      console.error('[WS] Failed to parse message:', err)
    }
  })
  
  ws.on('close', () => {
    clients.delete(clientId)
    console.log(`[WS] Client disconnected: ${clientId}`)
  })
  
  ws.on('error', (err) => {
    console.error(`[WS] Client error (${clientId}):`, err.message)
  })
})

/**
 * Handle incoming WebSocket messages
 */
function handleWebSocketMessage(clientId, message) {
  const client = clients.get(clientId)
  if (!client) return
  
  switch (message.type) {
    case 'identify':
      client.type = message.clientType || 'unknown'
      console.log(`[WS] Client ${clientId} identified as: ${client.type}`)
      break
      
    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong' }))
      break
      
    case 'element-selected':
      // Store selected element keyed by the WS auth token (session-scoped)
      // The token was validated on connection, extract from client
      const wsToken = client.token || clientId
      console.log(`[WS] Element selected:`, message.element?.selector)
      selectedElements.set(wsToken, {
        element: message.element,
        timestamp: Date.now()
      })
      break
      
    default:
      // Check if this is a response to a pending HTTP request
      if (message.requestId && pendingRequests.has(message.requestId)) {
        console.log(`[API] Received response for requestId: ${message.requestId}, type: ${message.type}`)
        const pending = pendingRequests.get(message.requestId)
        clearTimeout(pending.timeout)
        pendingRequests.delete(message.requestId)
        pending.res.json(message)
      } else {
        console.log(`[WS] Message from ${clientId}:`, message.type, message.requestId ? `(requestId: ${message.requestId})` : '')
      }
  }
}

/**
 * Broadcast message to all connected clients of a specific type
 */
function broadcastToType(type, message) {
  const data = JSON.stringify(message)
  for (const [, client] of clients) {
    if (client.type === type && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data)
    }
  }
}

// =============================================================================
// START SERVER
// =============================================================================

/**
 * Generate connection code for easy copy/paste setup
 * Format: oko:BASE64(url|token)
 */
function generateConnectionCode(url, token) {
  const payload = `${url}|${token}`
  return `oko:${Buffer.from(payload).toString('base64')}`
}

/**
 * Get the public URL for a port using gitpod CLI
 * Falls back to environment variables if CLI fails
 */
async function getGitpodPortUrl(port) {
  const { execSync } = require('child_process')
  
  try {
    // Try gitpod CLI first - most reliable
    const output = execSync(`gitpod environment port list -o json`, { 
      encoding: 'utf-8',
      timeout: 5000 
    })
    const ports = JSON.parse(output)
    const portInfo = ports.find(p => p.port === port)
    if (portInfo?.url) {
      return portInfo.url
    }
  } catch (e) {
    console.log('[Server] gitpod CLI not available, trying env vars')
  }
  
  // Fallback to environment variables
  const gitpodEnvId = process.env.GITPOD_ENVIRONMENT_ID
  if (gitpodEnvId) {
    const region = process.env.GITPOD_REGION || 'us-east-1-01'
    return `https://${port}--${gitpodEnvId}.${region}.gitpod.dev`
  }
  
  return null
}

server.listen(PORT, async () => {
  console.log(`[Server] Oko backend listening on port ${PORT}`)
  
  // Try to get Gitpod URL for connection code
  const backendUrl = await getGitpodPortUrl(PORT)
  
  if (backendUrl) {
    // Running in Gitpod/Ona environment - output the remote URL config
    const connectionCode = generateConnectionCode(backendUrl, WS_AUTH_TOKEN)
    console.log('')
    console.log('='.repeat(60))
    console.log('  Oko Extension - paste this code in the extension popup:')
    console.log('='.repeat(60))
    console.log('')
    console.log(`  ${connectionCode}`)
    console.log('')
    console.log('='.repeat(60))
    console.log('')
  } else {
    // Local development - no code needed, extension auto-detects localhost
    console.log(`[Server] Health check: http://localhost:${PORT}/api/health`)
    console.log('[Server] Local mode (no auth required for localhost)')
  }
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...')
  wss.close()
  server.close()
  process.exit(0)
})

module.exports = { app, server, wss, broadcastToType }

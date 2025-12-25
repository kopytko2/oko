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
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
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
    return true
  }
  
  return token === WS_AUTH_TOKEN
}

/**
 * Auth middleware for protected routes
 */
function requireAuth(req, res, next) {
  if (!validateToken(req)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing auth token'
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
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '0.1.0'
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
  if (!validateToken(req)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Auth token required for remote access'
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
const SELECTION_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get session ID from auth token (for per-user scoping)
 */
function getSessionId(req) {
  const token = req.headers['x-auth-token'] || ''
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
}

app.get('/api/browser/tabs', async (req, res) => {
  const requestId = crypto.randomUUID()
  
  // Find extension client
  let extensionClient = null
  for (const [, client] of clients) {
    if (client.type === 'extension' && client.ws.readyState === WebSocket.OPEN) {
      extensionClient = client
      break
    }
  }
  
  if (!extensionClient) {
    return res.status(503).json({ success: false, error: 'No extension connected' })
  }
  
  // Send request to extension
  extensionClient.ws.send(JSON.stringify({
    type: 'browser-list-tabs',
    requestId
  }))
  
  // Wait for response
  const timeout = setTimeout(() => {
    pendingRequests.delete(requestId)
    res.status(504).json({ success: false, error: 'Extension timeout' })
  }, 10000)
  
  pendingRequests.set(requestId, { res, timeout })
})

/**
 * Get session key for selected elements
 * Uses auth token if provided, otherwise uses a fixed key for localhost/no-auth
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

// Get selected element for this session (scoped by auth token)
app.get('/api/browser/selected-element', requireAuth, (req, res) => {
  const key = getSelectionKey(req)
  const entry = selectedElements.get(key)
  
  // Check TTL
  if (!entry || Date.now() - entry.timestamp > SELECTION_TTL_MS) {
    if (entry) selectedElements.delete(key)
    return res.json({ success: false, error: 'No element selected (use Alt+Shift+O to pick an element)' })
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

app.post('/api/browser/element-info', async (req, res) => {
  const requestId = crypto.randomUUID()
  const { tabId, selector, includeStyles } = req.body
  
  if (!selector) {
    return res.status(400).json({ success: false, error: 'selector required' })
  }
  
  let extensionClient = null
  for (const [, client] of clients) {
    if (client.type === 'extension' && client.ws.readyState === WebSocket.OPEN) {
      extensionClient = client
      break
    }
  }
  
  if (!extensionClient) {
    return res.status(503).json({ success: false, error: 'No extension connected' })
  }
  
  extensionClient.ws.send(JSON.stringify({
    type: 'browser-get-element-info',
    requestId,
    tabId,
    selector,
    includeStyles: includeStyles !== false
  }))
  
  const timeout = setTimeout(() => {
    pendingRequests.delete(requestId)
    res.status(504).json({ success: false, error: 'Extension timeout' })
  }, 10000)
  
  pendingRequests.set(requestId, { res, timeout })
})

app.post('/api/browser/click', async (req, res) => {
  const requestId = crypto.randomUUID()
  const { tabId, selector } = req.body
  
  if (!selector) {
    return res.status(400).json({ success: false, error: 'selector required' })
  }
  
  let extensionClient = null
  for (const [, client] of clients) {
    if (client.type === 'extension' && client.ws.readyState === WebSocket.OPEN) {
      extensionClient = client
      break
    }
  }
  
  if (!extensionClient) {
    return res.status(503).json({ success: false, error: 'No extension connected' })
  }
  
  extensionClient.ws.send(JSON.stringify({
    type: 'browser-click-element',
    requestId,
    tabId,
    selector
  }))
  
  const timeout = setTimeout(() => {
    pendingRequests.delete(requestId)
    res.status(504).json({ success: false, error: 'Extension timeout' })
  }, 10000)
  
  pendingRequests.set(requestId, { res, timeout })
})

app.get('/api/browser/screenshot', async (req, res) => {
  const requestId = crypto.randomUUID()
  const tabId = req.query.tabId ? parseInt(req.query.tabId) : undefined
  
  let extensionClient = null
  for (const [, client] of clients) {
    if (client.type === 'extension' && client.ws.readyState === WebSocket.OPEN) {
      extensionClient = client
      break
    }
  }
  
  if (!extensionClient) {
    return res.status(503).json({ success: false, error: 'No extension connected' })
  }
  
  extensionClient.ws.send(JSON.stringify({
    type: 'browser-screenshot',
    requestId,
    tabId
  }))
  
  const timeout = setTimeout(() => {
    pendingRequests.delete(requestId)
    res.status(504).json({ success: false, error: 'Extension timeout' })
  }, 10000)
  
  pendingRequests.set(requestId, { res, timeout })
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
        const pending = pendingRequests.get(message.requestId)
        clearTimeout(pending.timeout)
        pendingRequests.delete(message.requestId)
        pending.res.json(message)
      } else {
        console.log(`[WS] Message from ${clientId}:`, message.type)
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

server.listen(PORT, () => {
  console.log(`[Server] Oko backend listening on port ${PORT}`)
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`)
  if (process.env.OKO_AUTH_TOKEN) {
    console.log('[Server] Remote auth enabled (OKO_AUTH_TOKEN set)')
  } else {
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

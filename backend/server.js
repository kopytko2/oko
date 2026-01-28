/**
 * Oko Backend Server
 * Provides browser automation APIs for Ona environments
 * 
 * Module structure:
 * - lib/config.js    - Configuration and constants
 * - lib/cors.js      - CORS middleware
 * - lib/auth.js      - Authentication middleware
 * - lib/validation.js - Input validation utilities
 */

import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import http from 'http'
import { WebSocketServer } from 'ws'
import crypto from 'crypto'
import fs from 'fs'
import { execSync } from 'child_process'

// Import from lib modules
import {
  PORT,
  WS_AUTH_TOKEN,
  TOKEN_EXPIRY_MS,
  TOKEN_CREATED_AT,
  isTokenExpired,
  EXTENSION_REQUEST_TIMEOUT_MS,
  EXTENSION_FULL_PAGE_TIMEOUT_MS,
  initTokenFile,
} from './lib/config.js'

import {
  privateNetworkMiddleware,
  corsOptions,
} from './lib/cors.js'

import {
  isLocalRequest,
  validateToken,
  requireAuth,
} from './lib/auth.js'

import {
  parseInteger,
  parseString,
  parseStringArray,
  getSessionId,
  getSelectionKey,
} from './lib/validation.js'

const WebSocket = { OPEN: 1 } // WebSocket.OPEN constant

// Initialize token file
initTokenFile()

// =============================================================================
// EXPRESS APP
// =============================================================================

const app = express()
const server = http.createServer(app)

// JSON body parser
app.use(express.json())

// CORS configuration (from lib/cors.js)
app.use(privateNetworkMiddleware)
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

// Auth middleware imported from lib/auth.js

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

// Validation utilities imported from lib/validation.js

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

  const tabIdValue = body.tabId
  const tabId = parseInteger(tabIdValue)
  if (tabIdValue !== undefined && (tabId === null || tabId < 0)) {
    return res.status(400).json({ success: false, error: 'tabId must be a non-negative integer' })
  }

  const newTab = body.newTab === true
  const active = body.active !== false

  sendToExtension(req, res, 'browser-navigate', {
    url,
    tabId: tabId !== null ? tabId : undefined,
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
    return res.json({ success: true, element: null, hint: 'Use Alt+Shift+A to pick an element' })
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

app.post('/api/browser/fill', async (req, res) => {
  const body = req.body || {}
  const selector = parseString(body.selector, 1000)
  if (!selector) {
    return res.status(400).json({ success: false, error: 'selector required' })
  }

  const value = body.value
  if (typeof value !== 'string') {
    return res.status(400).json({ success: false, error: 'value required (string)' })
  }

  const tabIdValue = body.tabId
  const tabId = parseInteger(tabIdValue)
  if (tabIdValue !== undefined && (tabId === null || tabId < 0)) {
    return res.status(400).json({ success: false, error: 'tabId must be a non-negative integer' })
  }

  sendToExtension(req, res, 'browser-fill-input', {
    tabId,
    selector,
    value
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

const wss = new WebSocketServer({ server })

// Track connected clients
const clients = new Map()

// Auth timeout for first-message auth (5 seconds)
const WS_AUTH_TIMEOUT_MS = 5000

wss.on('connection', (ws, req) => {
  const clientId = crypto.randomUUID()
  
  // Check if connection is from localhost using socket address
  const remoteAddr = req.socket?.remoteAddress || ''
  const isLocal = remoteAddr === '127.0.0.1' || 
                  remoteAddr === '::1' || 
                  remoteAddr === '::ffff:127.0.0.1'
  const isLocalNoAuth = isLocal && !process.env.OKO_AUTH_TOKEN
  
  // For localhost without env token, auto-authenticate
  if (isLocalNoAuth) {
    clients.set(clientId, { ws, type: 'unknown', token: '__local__', authenticated: true })
    console.log(`[WS] Client connected (localhost): ${clientId}`)
    setupClientHandlers(clientId, ws)
    return
  }
  
  // For remote connections, require first-message auth
  // Client must send { type: 'auth', token: '...' } within timeout
  clients.set(clientId, { ws, type: 'unknown', token: null, authenticated: false })
  console.log(`[WS] Client connected (pending auth): ${clientId}`)
  
  const authTimeout = setTimeout(() => {
    const client = clients.get(clientId)
    if (client && !client.authenticated) {
      console.warn(`[WS] Auth timeout for client ${clientId}`)
      ws.close(4001, 'Auth timeout')
      clients.delete(clientId)
    }
  }, WS_AUTH_TIMEOUT_MS)
  
  // Handle first message for auth
  const authHandler = (data) => {
    try {
      const message = JSON.parse(data.toString())
      
      if (message.type === 'auth') {
        clearTimeout(authTimeout)
        const token = message.token
        
        if (token !== WS_AUTH_TOKEN) {
          console.warn(`[WS] Invalid token from ${remoteAddr}`)
          ws.close(4001, 'Invalid token')
          clients.delete(clientId)
          return
        }
        
        if (isTokenExpired()) {
          console.warn(`[WS] Expired token from ${remoteAddr}`)
          ws.close(4001, 'Token expired')
          clients.delete(clientId)
          return
        }
        
        // Auth successful
        const client = clients.get(clientId)
        if (client) {
          client.authenticated = true
          client.token = token
          console.log(`[WS] Client authenticated: ${clientId}`)
          ws.send(JSON.stringify({ type: 'auth-success' }))
          
          // Remove auth handler and set up normal handlers
          ws.removeListener('message', authHandler)
          setupClientHandlers(clientId, ws)
        }
      } else {
        // Non-auth message before authentication
        console.warn(`[WS] Unauthenticated message from ${clientId}: ${message.type}`)
        ws.close(4001, 'Auth required')
        clients.delete(clientId)
        clearTimeout(authTimeout)
      }
    } catch (err) {
      console.error('[WS] Failed to parse auth message:', err)
      ws.close(4002, 'Invalid message')
      clients.delete(clientId)
      clearTimeout(authTimeout)
    }
  }
  
  ws.on('message', authHandler)
  
  ws.on('close', () => {
    clearTimeout(authTimeout)
    clients.delete(clientId)
    console.log(`[WS] Client disconnected: ${clientId}`)
  })
  
  ws.on('error', (err) => {
    clearTimeout(authTimeout)
    console.error(`[WS] Client error (${clientId}):`, err.message)
  })
})

/**
 * Set up message handlers for authenticated client
 */
function setupClientHandlers(clientId, ws) {
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
}

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

// Start server only when run directly (not when imported for testing)
const isMainModule = process.argv[1]?.endsWith('server.js')
if (isMainModule) {
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
}

export { app, server, wss, broadcastToType, PORT, WS_AUTH_TOKEN }

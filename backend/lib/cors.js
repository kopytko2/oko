/**
 * CORS configuration
 */

import cors from 'cors'

// Handle Private Network Access preflight BEFORE cors() (Chrome 94+)
export function privateNetworkMiddleware(req, res, next) {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  next()
}

export const corsOptions = {
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

export const corsMiddleware = cors(corsOptions)

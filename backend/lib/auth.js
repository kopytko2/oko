/**
 * Authentication middleware and utilities
 */

import { WS_AUTH_TOKEN, isTokenExpired } from './config.js'

/**
 * Check if request is from localhost using socket address (not spoofable Host header)
 */
export function isLocalRequest(req) {
  const remoteAddr = req.socket?.remoteAddress || req.ip || ''
  // IPv4 localhost or IPv6 localhost
  return remoteAddr === '127.0.0.1' || 
         remoteAddr === '::1' || 
         remoteAddr === '::ffff:127.0.0.1'
}

/**
 * Validate auth token from header or query param
 * Returns { valid: true } or { valid: false, reason: string }
 */
export function validateToken(req) {
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
export function requireAuth(req, res, next) {
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

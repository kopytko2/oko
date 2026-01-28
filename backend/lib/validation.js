/**
 * Input validation utilities
 */

import crypto from 'crypto'
import { isLocalRequest } from './auth.js'

/**
 * Parse integer from various input types
 * Returns null if invalid
 */
export function parseInteger(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return null
}

/**
 * Parse and validate string
 * Returns null if invalid or empty
 */
export function parseString(value, maxLength) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (maxLength && trimmed.length > maxLength) return null
  return trimmed
}

/**
 * Parse string array
 * Returns undefined if not provided, null if invalid
 */
export function parseStringArray(value, maxLength) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const parsed = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    if (maxLength && item.length > maxLength) return null
    parsed.push(item)
  }
  return parsed
}

/**
 * Get session ID from auth token (for per-user scoping)
 */
export function getSessionId(req) {
  const token = req.headers['x-auth-token'] || ''
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/**
 * Get session key for selected elements and extension targeting
 */
export function getSelectionKey(req) {
  // For localhost without OKO_AUTH_TOKEN env var, always use __local__
  if (!process.env.OKO_AUTH_TOKEN && isLocalRequest(req)) {
    return '__local__'
  }
  const token = req.headers['x-auth-token'] || req.query.token || ''
  return token || '__local__'
}

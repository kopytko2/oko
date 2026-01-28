/**
 * Server configuration
 */

import crypto from 'crypto'
import fs from 'fs'

export const PORT = process.env.PORT || 8129
export const WS_AUTH_TOKEN_FILE = '/tmp/oko-auth-token'

// Auth token: use environment variable for remote, generate random for local
export const WS_AUTH_TOKEN = process.env.OKO_AUTH_TOKEN || crypto.randomBytes(32).toString('hex')

// Token expiry: 24 hours from server start (configurable via env)
export const TOKEN_EXPIRY_MS = parseInt(process.env.OKO_TOKEN_EXPIRY_HOURS || '24', 10) * 60 * 60 * 1000
export const TOKEN_CREATED_AT = Date.now()

export function isTokenExpired() {
  return Date.now() - TOKEN_CREATED_AT > TOKEN_EXPIRY_MS
}

export const EXTENSION_REQUEST_TIMEOUT_MS = 10000
export const EXTENSION_FULL_PAGE_TIMEOUT_MS = 30000

// Write token to file for local development
export function initTokenFile() {
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
}

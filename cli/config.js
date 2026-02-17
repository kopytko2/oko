import fs from 'fs'
import { UsageError } from './errors.js'
import { parseConnectionCode } from './connection-code.js'

const DEFAULT_URL = 'http://localhost:8129'
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_OUTPUT = 'json'

function readTokenFromFile(path = '/tmp/oko-auth-token') {
  try {
    const token = fs.readFileSync(path, 'utf8').trim()
    return token || null
  } catch {
    return null
  }
}

function toPositiveInteger(raw, name) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new UsageError(`${name} must be a positive integer`)
  }
  return n
}

export function isLocalUrl(urlString) {
  try {
    const parsed = new URL(urlString)
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1'
  } catch {
    return false
  }
}

export function resolveRuntimeConfig(globalOptions = {}, env = process.env) {
  const code = globalOptions.connectionCode
  const parsedCode = code ? parseConnectionCode(code) : null
  if (code && !parsedCode) {
    throw new UsageError('Invalid --connection-code (expected format: oko:BASE64(url|token))')
  }

  const url = globalOptions.url || parsedCode?.url || DEFAULT_URL
  const timeoutMs = toPositiveInteger(globalOptions.timeoutMs, '--timeout-ms') || DEFAULT_TIMEOUT_MS
  const output = globalOptions.output || DEFAULT_OUTPUT
  if (!['json', 'ndjson', 'text'].includes(output)) {
    throw new UsageError("--output must be one of: json, ndjson, text")
  }

  let token = ''
  let tokenSource = 'none'

  if (globalOptions.token) {
    token = globalOptions.token
    tokenSource = 'flag'
  } else if (parsedCode?.token) {
    token = parsedCode.token
    tokenSource = 'connection_code'
  } else if (env.OKO_AUTH_TOKEN) {
    token = env.OKO_AUTH_TOKEN
    tokenSource = 'env'
  } else {
    const fileToken = readTokenFromFile()
    if (fileToken) {
      token = fileToken
      tokenSource = 'file'
    }
  }

  if (!token && isLocalUrl(url)) {
    tokenSource = 'localhost_no_token'
  }

  return {
    url,
    token,
    tokenSource,
    timeoutMs,
    output,
    parsedConnectionCode: parsedCode,
  }
}

import { CliAbortError, OkoHttpError, OkoNetworkError, UsageError } from './errors.js'

export function hintForError(status, message = '') {
  const lowered = message.toLowerCase()
  if (status === 503) {
    return 'No extension is connected. Open the Oko extension popup and connect it to this backend.'
  }
  if (status === 401) {
    return 'Auth failed. Check --token, --connection-code, OKO_AUTH_TOKEN, or /tmp/oko-auth-token.'
  }
  if (status === 504) {
    return 'Extension timeout. Interact with the browser tab and retry.'
  }
  if (lowered.includes('no debugger session')) {
    return 'Enable debugger capture first for the tab (or use `oko capture api`).'
  }
  if (lowered.includes('invalid token')) {
    return 'Token mismatch. Refresh token and reconnect extension.'
  }
  return undefined
}

export function toErrorEnvelope(err) {
  if (err instanceof UsageError) {
    return {
      success: false,
      error: err.message,
      status: 400,
      hint: 'Run with --help for command usage.',
      exitCode: err.exitCode || 2,
    }
  }

  if (err instanceof CliAbortError) {
    return {
      success: false,
      error: err.message,
      status: 499,
      hint: 'Capture was interrupted, cleanup was attempted.',
      exitCode: err.exitCode || 130,
    }
  }

  if (err instanceof OkoHttpError) {
    const message = err.body?.error || err.body?.message || err.message
    return {
      success: false,
      error: message,
      status: err.status,
      hint: hintForError(err.status, message),
      details: err.body,
      exitCode: 1,
    }
  }

  if (err instanceof OkoNetworkError) {
    return {
      success: false,
      error: err.message,
      status: 0,
      hint: 'Check backend URL reachability and local network state.',
      exitCode: 1,
    }
  }

  return {
    success: false,
    error: err instanceof Error ? err.message : String(err),
    status: 1,
    exitCode: 1,
  }
}

function stringifyText(data, commandKey) {
  if (!data || typeof data !== 'object') return String(data)

  if (commandKey === 'tabs.list') {
    const tabs = Array.isArray(data.tabs) ? data.tabs : []
    if (tabs.length === 0) return 'No tabs found.'
    return tabs
      .map((tab) => `${tab.active ? '*' : ' '} ${tab.id}\t${tab.title || '(no title)'}\t${tab.url || ''}`)
      .join('\n')
  }

  if (commandKey === 'capture.api') {
    const lines = [
      `tabId: ${data.tabId}`,
      `mode: ${data.mode}`,
      `requests: ${data.total ?? 0}`,
    ]
    if (data.out) lines.push(`saved: ${data.out}`)
    return lines.join('\n')
  }

  if (commandKey === 'connect.code') {
    return data.connectionCode || ''
  }

  return JSON.stringify(data, null, 2)
}

export function writeData(data, output, commandKey, stream = process.stdout) {
  if (output === 'text') {
    stream.write(`${stringifyText(data, commandKey)}\n`)
    return
  }

  if (output === 'ndjson') {
    if (Array.isArray(data)) {
      for (const row of data) {
        stream.write(`${JSON.stringify(row)}\n`)
      }
      return
    }
    if (Array.isArray(data?.requests)) {
      for (const row of data.requests) {
        stream.write(`${JSON.stringify(row)}\n`)
      }
      return
    }
    stream.write(`${JSON.stringify(data)}\n`)
    return
  }

  stream.write(`${JSON.stringify(data, null, 2)}\n`)
}

export function writeError(envelope, output, stream = process.stderr) {
  if (output === 'text') {
    const pieces = [
      `Error: ${envelope.error}`,
      envelope.status ? `Status: ${envelope.status}` : null,
      envelope.hint ? `Hint: ${envelope.hint}` : null,
    ].filter(Boolean)
    stream.write(`${pieces.join('\n')}\n`)
    return
  }

  stream.write(`${JSON.stringify(envelope, null, output === 'json' ? 2 : 0)}\n`)
}

export function serializeForFile(data, output) {
  if (output === 'ndjson') {
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.requests)
        ? data.requests
        : [data]
    return rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  }

  if (output === 'text') {
    return JSON.stringify(data, null, 2) + '\n'
  }

  return JSON.stringify(data, null, 2) + '\n'
}

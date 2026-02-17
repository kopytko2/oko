/**
 * Parse connection code format: oko:BASE64(url|token)
 */
export function parseConnectionCode(code: string): { url: string; token: string } | null {
  const trimmed = code.trim()
  if (!trimmed.startsWith('oko:')) return null

  try {
    const base64 = trimmed.slice(4)
    const decoded = decodeBase64(base64)
    const pipeIndex = decoded.indexOf('|')
    if (pipeIndex === -1) return null

    const url = decoded.slice(0, pipeIndex)
    const token = decoded.slice(pipeIndex + 1)
    if (!url || !token) return null

    return { url, token }
  } catch {
    return null
  }
}

/**
 * Generate a connection code from URL and token.
 */
export function generateConnectionCode(url: string, token: string): string {
  const payload = `${url}|${token}`
  return `oko:${encodeBase64(payload)}`
}

function decodeBase64(value: string): string {
  const g = globalThis as unknown as {
    atob?: (s: string) => string
    Buffer?: { from: (v: string, encoding: string) => { toString: (targetEncoding: string) => string } }
  }

  if (typeof g.atob === 'function') {
    return g.atob(value)
  }

  if (g.Buffer) {
    return g.Buffer.from(value, 'base64').toString('utf8')
  }

  throw new Error('No base64 decoder available in runtime')
}

function encodeBase64(value: string): string {
  const g = globalThis as unknown as {
    btoa?: (s: string) => string
    Buffer?: { from: (v: string, encoding: string) => { toString: (targetEncoding: string) => string } }
  }

  if (typeof g.btoa === 'function') {
    return g.btoa(value)
  }

  if (g.Buffer) {
    return g.Buffer.from(value, 'utf8').toString('base64')
  }

  throw new Error('No base64 encoder available in runtime')
}

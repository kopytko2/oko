import { OkoHttpError, OkoNetworkError } from './errors.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizePath(path) {
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

function buildUrl(baseUrl, path, query) {
  const target = new URL(normalizePath(path), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) {
            target.searchParams.append(key, String(item))
          }
        }
      } else {
        target.searchParams.set(key, String(value))
      }
    }
  }
  return target.toString()
}

async function parseBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  const text = await response.text()
  return text ? { message: text } : null
}

export function createApiClient(config, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (!fetchImpl) {
    throw new Error('Fetch API is unavailable in this Node runtime')
  }

  const baseUrl = config.url
  const token = config.token
  const timeoutMs = config.timeoutMs

  async function request(method, path, requestOptions = {}) {
    const {
      query,
      body,
      retry504 = 1,
      omitAuth = false,
    } = requestOptions

    const url = buildUrl(baseUrl, path, query)
    const headers = {
      Accept: 'application/json',
    }

    if (!omitAuth && token) {
      headers['X-Auth-Token'] = token
    }

    let payload
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    let attempt = 0
    while (true) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(url, {
          method,
          headers,
          body: payload,
          signal: controller.signal,
        })

        const parsed = await parseBody(response)

        if (!response.ok) {
          const message = parsed?.error || parsed?.message || `HTTP ${response.status}`
          if (response.status === 504 && attempt < retry504) {
            attempt += 1
            await sleep(200 * attempt)
            continue
          }
          throw new OkoHttpError(message, response.status, parsed)
        }

        return parsed ?? { success: true }
      } catch (err) {
        if (err instanceof OkoHttpError) {
          throw err
        }
        if (err?.name === 'AbortError') {
          throw new OkoNetworkError(`Request timed out after ${timeoutMs}ms`, err)
        }
        throw new OkoNetworkError('Network request failed', err)
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options = {}) => request('POST', path, { ...options, body }),
    del: (path, options) => request('DELETE', path, options),
  }
}

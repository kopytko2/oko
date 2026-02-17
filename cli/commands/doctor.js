export async function runDoctor({ client, config }) {
  const result = {
    success: false,
    backend: {
      ok: false,
      status: null,
      response: null,
      error: null,
    },
    auth: {
      tokenConfigured: Boolean(config.token),
      tokenSource: config.tokenSource,
      usingLocalhostFallback: config.tokenSource === 'localhost_no_token',
    },
    extension: {
      connected: false,
      tabCount: 0,
      error: null,
    },
    config: {
      url: config.url,
      timeoutMs: config.timeoutMs,
      output: config.output,
    },
  }

  try {
    const health = await client.get('/api/health', { omitAuth: true, retry504: 0 })
    result.backend.ok = true
    result.backend.status = health?.status || 'ok'
    result.backend.response = health
  } catch (err) {
    result.backend.error = err instanceof Error ? err.message : String(err)
    return result
  }

  try {
    const tabs = await client.get('/api/browser/tabs', { retry504: 0 })
    const tabList = Array.isArray(tabs?.tabs) ? tabs.tabs : []
    result.extension.connected = true
    result.extension.tabCount = tabList.length
  } catch (err) {
    result.extension.error = err instanceof Error ? err.message : String(err)
  }

  result.success = result.backend.ok && result.extension.connected
  return result
}

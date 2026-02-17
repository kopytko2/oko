import http from 'http'
import { describe, expect, it } from 'vitest'
import { createApiClient } from '../client.js'
import { runDoctor } from '../commands/doctor.js'

async function startServer(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const url = `http://127.0.0.1:${address.port}`
  return {
    url,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

describe('doctor integration', () => {
  it('reports healthy backend and connected extension', async () => {
    const mock = await startServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }
      if (req.url === '/api/browser/tabs') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, tabs: [{ id: 1, active: true, title: 'Test', url: 'https://example.com' }] }))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })

    try {
      const client = createApiClient({ url: mock.url, token: '', timeoutMs: 1000 })
      const result = await runDoctor({
        client,
        config: { url: mock.url, timeoutMs: 1000, output: 'json', token: '', tokenSource: 'localhost_no_token' },
      })

      expect(result.success).toBe(true)
      expect(result.backend.ok).toBe(true)
      expect(result.extension.connected).toBe(true)
      expect(result.extension.tabCount).toBe(1)
    } finally {
      await mock.close()
    }
  })

  it('reports disconnected extension when tabs endpoint returns 503', async () => {
    const mock = await startServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }
      if (req.url === '/api/browser/tabs') {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'No extension connected' }))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })

    try {
      const client = createApiClient({ url: mock.url, token: '', timeoutMs: 1000 })
      const result = await runDoctor({
        client,
        config: { url: mock.url, timeoutMs: 1000, output: 'json', token: '', tokenSource: 'localhost_no_token' },
      })

      expect(result.success).toBe(false)
      expect(result.backend.ok).toBe(true)
      expect(result.extension.connected).toBe(false)
      expect(result.extension.error).toMatch(/No extension connected/i)
    } finally {
      await mock.close()
    }
  })
})

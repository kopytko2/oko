import { EventEmitter } from 'events'
import { describe, expect, it } from 'vitest'
import { runCaptureApi } from '../commands/capture.js'

function createFakeProcess() {
  const emitter = new EventEmitter()
  emitter.once = emitter.once.bind(emitter)
  emitter.removeListener = emitter.removeListener.bind(emitter)
  return emitter
}

describe('capture api integration', () => {
  it('disables debugger after successful capture', async () => {
    const calls = []
    const client = {
      async get(path) {
        calls.push(['get', path])
        if (path === '/api/browser/tabs') {
          return { success: true, tabs: [{ id: 123, active: true, url: 'https://example.com' }] }
        }
        if (path === '/api/browser/debugger/requests') {
          return { success: true, total: 1, requests: [{ url: 'https://example.com/api', method: 'GET' }] }
        }
        throw new Error(`Unexpected GET ${path}`)
      },
      async post(path, body) {
        calls.push(['post', path, body])
        return { success: true }
      },
    }

    const result = await runCaptureApi({
      client,
      options: {
        tabId: undefined,
        tabUrl: undefined,
        active: true,
        mode: 'full',
        urlPattern: undefined,
        duration: 0.01,
        untilEnter: false,
        maxRequests: 500,
        limit: 100,
        out: undefined,
      },
      output: 'json',
      io: { stdin: process.stdin, stdout: process.stdout },
      processRef: createFakeProcess(),
    })

    expect(result.success).toBe(true)
    expect(calls.some((c) => c[1] === '/api/browser/debugger/disable')).toBe(true)
  })

  it('disables debugger even if fetching requests fails', async () => {
    const calls = []
    const client = {
      async get(path) {
        calls.push(['get', path])
        if (path === '/api/browser/tabs') {
          return { success: true, tabs: [{ id: 123, active: true, url: 'https://example.com' }] }
        }
        if (path === '/api/browser/debugger/requests') {
          throw new Error('fetch failed')
        }
        throw new Error(`Unexpected GET ${path}`)
      },
      async post(path, body) {
        calls.push(['post', path, body])
        return { success: true }
      },
    }

    await expect(runCaptureApi({
      client,
      options: {
        tabId: undefined,
        tabUrl: undefined,
        active: true,
        mode: 'full',
        urlPattern: undefined,
        duration: 0.01,
        untilEnter: false,
        maxRequests: 500,
        limit: 100,
        out: undefined,
      },
      output: 'json',
      io: { stdin: process.stdin, stdout: process.stdout },
      processRef: createFakeProcess(),
    })).rejects.toThrow(/fetch failed/i)

    expect(calls.some((c) => c[1] === '/api/browser/debugger/disable')).toBe(true)
  })

  it('streams NDJSON lines in follow mode and still disables debugger', async () => {
    const calls = []
    let requestFetches = 0
    const writes = []
    const client = {
      async get(path) {
        calls.push(['get', path])
        if (path === '/api/browser/tabs') {
          return { success: true, tabs: [{ id: 123, active: true, url: 'https://example.com' }] }
        }
        if (path === '/api/browser/debugger/requests') {
          requestFetches += 1
          if (requestFetches === 1) {
            return {
              success: true,
              total: 2,
              requests: [
                { requestId: 'b', url: 'https://example.com/b', method: 'GET' },
                { requestId: 'a', url: 'https://example.com/a', method: 'GET' },
              ],
            }
          }
          return {
            success: true,
            total: 2,
            requests: [
              { requestId: 'b', url: 'https://example.com/b', method: 'GET' },
              { requestId: 'a', url: 'https://example.com/a', method: 'GET' },
            ],
          }
        }
        throw new Error(`Unexpected GET ${path}`)
      },
      async post(path, body) {
        calls.push(['post', path, body])
        return { success: true }
      },
    }

    const result = await runCaptureApi({
      client,
      options: {
        tabId: undefined,
        tabUrl: undefined,
        active: true,
        follow: true,
        followPollMs: 5,
        mode: 'full',
        urlPattern: undefined,
        duration: 0.02,
        untilEnter: false,
        maxRequests: 500,
        limit: 100,
        out: undefined,
      },
      output: 'json',
      io: {
        stdin: process.stdin,
        stdout: { write: (value) => writes.push(value) },
      },
      processRef: createFakeProcess(),
    })

    expect(result.success).toBe(true)
    expect(result.streamed).toBe(true)
    expect(result._skipOutput).toBe(true)
    expect(result.streamedCount).toBe(2)
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[0])).toMatchObject({ requestId: 'a' })
    expect(JSON.parse(writes[1])).toMatchObject({ requestId: 'b' })
    expect(calls.some((c) => c[1] === '/api/browser/debugger/disable')).toBe(true)
  })
})

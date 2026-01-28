/**
 * WebSocket integration tests for Oko backend
 * Tests WebSocket connection, authentication, and message handling
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import WebSocket from 'ws'
import { server, wss, WS_AUTH_TOKEN } from '../server.js'

const AUTH_TOKEN = WS_AUTH_TOKEN
const TEST_PORT = 8130 // Use different port to avoid conflicts
const WS_URL = `ws://localhost:${TEST_PORT}`

// Helper to create WebSocket connection
function createWsConnection() {
  return new WebSocket(WS_URL)
}

// Helper to wait for WebSocket to open
function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve()
      return
    }
    ws.on('open', resolve)
    ws.on('error', reject)
    setTimeout(() => reject(new Error('Connection timeout')), 5000)
  })
}

// Helper to wait for a message
function waitForMessage(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Message timeout')), timeout)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
  })
}

// Helper to wait for close
function waitForClose(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve({ code: ws._closeCode, reason: ws._closeReason })
      return
    }
    const timer = setTimeout(() => reject(new Error('Close timeout')), timeout)
    ws.on('close', (code, reason) => {
      clearTimeout(timer)
      resolve({ code, reason: reason.toString() })
    })
  })
}

describe('WebSocket Server', () => {
  const connections = []

  beforeAll(async () => {
    // Start server on test port
    await new Promise((resolve) => {
      if (server.listening) {
        resolve()
      } else {
        server.listen(TEST_PORT, resolve)
      }
    })
  })

  afterEach(() => {
    // Close all test connections
    connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    })
    connections.length = 0
  })

  afterAll(() => {
    wss.close()
    server.close()
  })

  describe('Connection', () => {
    it('accepts WebSocket connections', async () => {
      const ws = createWsConnection()
      connections.push(ws)
      
      await waitForOpen(ws)
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('auto-authenticates localhost connections', async () => {
      const ws = createWsConnection()
      connections.push(ws)
      
      await waitForOpen(ws)
      
      // Send identify message (should work without auth for localhost)
      ws.send(JSON.stringify({ type: 'identify', clientType: 'extension' }))
      
      // Should not be closed
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })
  })

  describe('Message Handling', () => {
    it('responds to ping with pong', async () => {
      const ws = createWsConnection()
      connections.push(ws)
      
      await waitForOpen(ws)
      
      ws.send(JSON.stringify({ type: 'ping' }))
      
      const response = await waitForMessage(ws)
      expect(response.type).toBe('pong')
    })

    it('accepts identify message', async () => {
      const ws = createWsConnection()
      connections.push(ws)
      
      await waitForOpen(ws)
      
      ws.send(JSON.stringify({ type: 'identify', clientType: 'extension' }))
      
      // Should not close the connection
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('handles element-selected message', async () => {
      const ws = createWsConnection()
      connections.push(ws)
      
      await waitForOpen(ws)
      
      // Identify as extension
      ws.send(JSON.stringify({ type: 'identify', clientType: 'extension' }))
      
      // Send element selection
      ws.send(JSON.stringify({
        type: 'element-selected',
        element: {
          selector: 'button.test',
          tagName: 'BUTTON',
          text: 'Click me'
        }
      }))
      
      // Should not error
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })
  })

  describe('Request-Response Flow', () => {
    it('extension receives browser requests with requestId', async () => {
      const ws = createWsConnection()
      connections.push(ws)
      
      await waitForOpen(ws)
      
      // Identify as extension first
      ws.send(JSON.stringify({ type: 'identify', clientType: 'extension' }))
      
      // Wait for identify to be processed
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Set up message handler to capture incoming request
      let receivedRequest = null
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'browser-list-tabs' && msg.requestId) {
          receivedRequest = msg
          // Respond to prevent timeout
          ws.send(JSON.stringify({
            requestId: msg.requestId,
            success: true,
            tabs: []
          }))
        }
      })
      
      // Make HTTP request that should be routed to extension
      const http = await import('http')
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: TEST_PORT,
          path: '/api/browser/tabs',
          method: 'GET',
          headers: { 'X-Auth-Token': AUTH_TOKEN }
        }, (res) => {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => resolve({ status: res.statusCode, body: data }))
        })
        req.on('error', reject)
        req.end()
      })
      
      // Verify the extension received the request
      expect(receivedRequest).not.toBeNull()
      expect(receivedRequest.type).toBe('browser-list-tabs')
      expect(receivedRequest.requestId).toBeDefined()
    }, 15000)
  })

  describe('Error Handling', () => {
    it('handles malformed JSON gracefully', async () => {
      const ws = createWsConnection()
      connections.push(ws)
      
      await waitForOpen(ws)
      
      // Send malformed JSON
      ws.send('not valid json {{{')
      
      // Should not crash the server
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Connection may or may not be closed, but server should still work
      const ws2 = createWsConnection()
      connections.push(ws2)
      await waitForOpen(ws2)
      expect(ws2.readyState).toBe(WebSocket.OPEN)
    })

    it('handles unknown message types', async () => {
      const ws = createWsConnection()
      connections.push(ws)
      
      await waitForOpen(ws)
      
      // Send unknown message type
      ws.send(JSON.stringify({ type: 'unknown-type-xyz', data: 'test' }))
      
      // Should not crash
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })
  })

  describe('Multiple Clients', () => {
    it('handles multiple simultaneous connections', async () => {
      const ws1 = createWsConnection()
      const ws2 = createWsConnection()
      const ws3 = createWsConnection()
      connections.push(ws1, ws2, ws3)
      
      await Promise.all([
        waitForOpen(ws1),
        waitForOpen(ws2),
        waitForOpen(ws3)
      ])
      
      expect(ws1.readyState).toBe(WebSocket.OPEN)
      expect(ws2.readyState).toBe(WebSocket.OPEN)
      expect(ws3.readyState).toBe(WebSocket.OPEN)
      
      // All should respond to ping
      ws1.send(JSON.stringify({ type: 'ping' }))
      ws2.send(JSON.stringify({ type: 'ping' }))
      ws3.send(JSON.stringify({ type: 'ping' }))
      
      const [r1, r2, r3] = await Promise.all([
        waitForMessage(ws1),
        waitForMessage(ws2),
        waitForMessage(ws3)
      ])
      
      expect(r1.type).toBe('pong')
      expect(r2.type).toBe('pong')
      expect(r3.type).toBe('pong')
    })
  })
})

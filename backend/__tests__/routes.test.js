/**
 * Strict route tests for Oko backend
 * Tests all API routes for correct behavior, auth, and error handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { app, server, wss, WS_AUTH_TOKEN } from '../server.js'

const AUTH_TOKEN = WS_AUTH_TOKEN

describe('Oko Backend Routes', () => {
  beforeAll(async () => {
    // Start server for tests
    await new Promise((resolve) => {
      if (server.listening) {
        resolve()
      } else {
        server.listen(8129, resolve)
      }
    })
  })

  afterAll(() => {
    // Close server after all tests
    wss.close()
    server.close()
  })

  // =========================================================================
  // HEALTH & AUTH ENDPOINTS (no extension required)
  // =========================================================================

  describe('GET /api/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/api/health')
      
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('status')
      expect(['ok', 'token_expired']).toContain(res.body.status)
      expect(res.body).toHaveProperty('timestamp')
      expect(res.body).toHaveProperty('version')
      expect(res.body).toHaveProperty('tokenExpiresIn')
      expect(res.body).toHaveProperty('tokenExpiresAt')
    })

    it('does not require authentication', async () => {
      const res = await request(app).get('/api/health')
      expect(res.status).toBe(200)
    })
  })

  describe('GET /api/auth/token', () => {
    it('returns token for localhost requests', async () => {
      // supertest simulates localhost
      const res = await request(app).get('/api/auth/token')
      
      // Should return 200 for localhost (no OKO_AUTH_TOKEN env)
      if (!process.env.OKO_AUTH_TOKEN) {
        expect(res.status).toBe(200)
        expect(res.body).toHaveProperty('token')
        expect(typeof res.body.token).toBe('string')
        expect(res.body.token.length).toBeGreaterThan(0)
      }
    })
  })

  // =========================================================================
  // BROWSER API ROUTES - AUTH TESTS
  // =========================================================================

  describe('Browser API Authentication', () => {
    const protectedRoutes = [
      { method: 'get', path: '/api/browser/tabs' },
      { method: 'post', path: '/api/browser/navigate' },
      { method: 'get', path: '/api/browser/selected-element' },
      { method: 'delete', path: '/api/browser/selected-element' },
      { method: 'post', path: '/api/browser/network/enable' },
      { method: 'post', path: '/api/browser/network/disable' },
      { method: 'get', path: '/api/browser/network/requests' },
      { method: 'post', path: '/api/browser/debugger/enable' },
      { method: 'post', path: '/api/browser/debugger/disable' },
      { method: 'get', path: '/api/browser/debugger/requests' },
      { method: 'delete', path: '/api/browser/debugger/requests' },
      { method: 'post', path: '/api/browser/element-info' },
      { method: 'post', path: '/api/browser/click' },
      { method: 'get', path: '/api/browser/screenshot' },
    ]

    // Skip auth tests if no OKO_AUTH_TOKEN is set (localhost mode)
    const shouldTestAuth = !!process.env.OKO_AUTH_TOKEN

    it('skips auth tests in localhost mode (no OKO_AUTH_TOKEN)', () => {
      if (!shouldTestAuth) {
        expect(true).toBe(true) // Placeholder test
      } else {
        expect(protectedRoutes.length).toBeGreaterThan(0)
      }
    })

    if (shouldTestAuth) {
      protectedRoutes.forEach(({ method, path }) => {
        it(`${method.toUpperCase()} ${path} requires authentication`, async () => {
          const res = await request(app)[method](path)
          expect(res.status).toBe(401)
          expect(res.body).toHaveProperty('error', 'Unauthorized')
        })

        it(`${method.toUpperCase()} ${path} rejects invalid token`, async () => {
          const res = await request(app)[method](path)
            .set('X-Auth-Token', 'invalid-token')
          expect(res.status).toBe(401)
        })
      })
    }
  })

  // =========================================================================
  // BROWSER API ROUTES - NO EXTENSION CONNECTED
  // These tests verify proper 503 responses when no extension is connected
  // =========================================================================

  describe('Browser API - No Extension Connected', () => {
    const extensionRoutes = [
      { method: 'get', path: '/api/browser/tabs' },
      { method: 'post', path: '/api/browser/navigate', body: { url: 'https://example.com' } },
      { method: 'post', path: '/api/browser/network/enable', body: {} },
      { method: 'post', path: '/api/browser/network/disable', body: {} },
      { method: 'get', path: '/api/browser/network/requests' },
      { method: 'post', path: '/api/browser/element-info', body: { selector: 'h1' } },
      { method: 'post', path: '/api/browser/click', body: { selector: 'button' } },
      { method: 'get', path: '/api/browser/screenshot' },
    ]

    extensionRoutes.forEach(({ method, path, body }) => {
      it(`${method.toUpperCase()} ${path} returns 503 when no extension connected`, async () => {
        let req = request(app)[method](path)
          .set('X-Auth-Token', AUTH_TOKEN)
        
        if (body) {
          req = req.send(body)
        }
        
        const res = await req
        
        expect(res.status).toBe(503)
        expect(res.body).toHaveProperty('error', 'No extension connected')
      })
    })
  })

  // =========================================================================
  // INPUT VALIDATION TESTS
  // =========================================================================

  describe('Input Validation', () => {
    describe('POST /api/browser/navigate', () => {
      it('requires url parameter', async () => {
        const res = await request(app)
          .post('/api/browser/navigate')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({})
        
        expect(res.status).toBe(400)
        expect(res.body).toHaveProperty('error')
        expect(res.body.error).toMatch(/url/i)
      })

      it('rejects invalid tabId', async () => {
        const res = await request(app)
          .post('/api/browser/navigate')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ url: 'https://example.com', tabId: 'not-a-number' })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })

      it('rejects negative tabId', async () => {
        const res = await request(app)
          .post('/api/browser/navigate')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ url: 'https://example.com', tabId: -1 })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })
    })

    describe('POST /api/browser/debugger/enable', () => {
      it('requires tabId parameter', async () => {
        const res = await request(app)
          .post('/api/browser/debugger/enable')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({})
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })

      it('rejects invalid tabId', async () => {
        const res = await request(app)
          .post('/api/browser/debugger/enable')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ tabId: 'invalid' })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })
    })

    describe('POST /api/browser/debugger/disable', () => {
      it('requires tabId parameter', async () => {
        const res = await request(app)
          .post('/api/browser/debugger/disable')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({})
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })
    })

    describe('GET /api/browser/debugger/requests', () => {
      it('requires tabId parameter', async () => {
        const res = await request(app)
          .get('/api/browser/debugger/requests')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })

      it('rejects invalid tabId', async () => {
        const res = await request(app)
          .get('/api/browser/debugger/requests?tabId=invalid')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })
    })

    describe('DELETE /api/browser/debugger/requests', () => {
      it('requires tabId parameter', async () => {
        const res = await request(app)
          .delete('/api/browser/debugger/requests')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })
    })

    describe('POST /api/browser/element-info', () => {
      it('requires selector parameter', async () => {
        const res = await request(app)
          .post('/api/browser/element-info')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({})
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/selector/i)
      })

      it('rejects empty selector', async () => {
        const res = await request(app)
          .post('/api/browser/element-info')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ selector: '' })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/selector/i)
      })

      it('rejects invalid tabId', async () => {
        const res = await request(app)
          .post('/api/browser/element-info')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ selector: 'h1', tabId: 'invalid' })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })
    })

    describe('POST /api/browser/click', () => {
      it('requires selector parameter', async () => {
        const res = await request(app)
          .post('/api/browser/click')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({})
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/selector/i)
      })

      it('rejects empty selector', async () => {
        const res = await request(app)
          .post('/api/browser/click')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ selector: '   ' })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/selector/i)
      })
    })

    describe('POST /api/browser/fill', () => {
      it('requires selector parameter', async () => {
        const res = await request(app)
          .post('/api/browser/fill')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ value: 'test' })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/selector/i)
      })

      it('requires value parameter', async () => {
        const res = await request(app)
          .post('/api/browser/fill')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ selector: 'input' })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/value/i)
      })

      it('rejects invalid tabId', async () => {
        const res = await request(app)
          .post('/api/browser/fill')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ selector: 'input', value: 'test', tabId: 'invalid' })
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })

      it('accepts empty string value', async () => {
        const res = await request(app)
          .post('/api/browser/fill')
          .set('X-Auth-Token', AUTH_TOKEN)
          .send({ selector: 'input', value: '' })
        
        // Should get 503 (no extension) not 400 (validation error)
        expect(res.status).toBe(503)
      })
    })

    describe('GET /api/browser/screenshot', () => {
      it('rejects invalid tabId', async () => {
        const res = await request(app)
          .get('/api/browser/screenshot?tabId=invalid')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/tabId/i)
      })

      it('rejects invalid fullPage value', async () => {
        const res = await request(app)
          .get('/api/browser/screenshot?fullPage=maybe')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/fullPage/i)
      })

      it('accepts fullPage=true', async () => {
        const res = await request(app)
          .get('/api/browser/screenshot?fullPage=true')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        // Should get 503 (no extension) not 400 (validation error)
        expect(res.status).toBe(503)
      })

      it('accepts fullPage=false', async () => {
        const res = await request(app)
          .get('/api/browser/screenshot?fullPage=false')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(503)
      })
    })

    describe('GET /api/browser/network/requests', () => {
      it('rejects invalid limit', async () => {
        const res = await request(app)
          .get('/api/browser/network/requests?limit=invalid')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/limit/i)
      })

      it('rejects negative limit', async () => {
        const res = await request(app)
          .get('/api/browser/network/requests?limit=-5')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/limit/i)
      })

      it('rejects invalid offset', async () => {
        const res = await request(app)
          .get('/api/browser/network/requests?offset=invalid')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/offset/i)
      })

      it('rejects negative offset', async () => {
        const res = await request(app)
          .get('/api/browser/network/requests?offset=-1')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/offset/i)
      })
    })
  })

  // =========================================================================
  // SELECTED ELEMENT ROUTES (no extension required)
  // =========================================================================

  describe('Selected Element Routes', () => {
    describe('GET /api/browser/selected-element', () => {
      it('returns null when no element selected', async () => {
        const res = await request(app)
          .get('/api/browser/selected-element')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(200)
        expect(res.body).toHaveProperty('element', null)
      })
    })

    describe('DELETE /api/browser/selected-element', () => {
      it('clears selected element', async () => {
        const res = await request(app)
          .delete('/api/browser/selected-element')
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).toBe(200)
        expect(res.body).toHaveProperty('success', true)
      })
    })
  })

  // =========================================================================
  // CORS TESTS
  // =========================================================================

  describe('CORS Configuration', () => {
    it('allows chrome-extension origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'chrome-extension://abcdefghijklmnop')
      
      expect(res.headers['access-control-allow-origin']).toBe('chrome-extension://abcdefghijklmnop')
    })

    it('allows localhost origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:3000')
      
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    })

    it('allows gitpod.dev origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://8080--abc123.us-east-1-01.gitpod.dev')
      
      expect(res.headers['access-control-allow-origin']).toBe('https://8080--abc123.us-east-1-01.gitpod.dev')
    })
  })

  // =========================================================================
  // ROUTE EXISTENCE TESTS
  // Verify all documented routes exist
  // =========================================================================

  describe('Route Existence', () => {
    const allRoutes = [
      { method: 'get', path: '/api/health' },
      { method: 'get', path: '/api/auth/token' },
      { method: 'get', path: '/api/browser/tabs' },
      { method: 'post', path: '/api/browser/navigate' },
      { method: 'get', path: '/api/browser/selected-element' },
      { method: 'delete', path: '/api/browser/selected-element' },
      { method: 'post', path: '/api/browser/network/enable' },
      { method: 'post', path: '/api/browser/network/disable' },
      { method: 'get', path: '/api/browser/network/requests' },
      { method: 'post', path: '/api/browser/debugger/enable' },
      { method: 'post', path: '/api/browser/debugger/disable' },
      { method: 'get', path: '/api/browser/debugger/requests' },
      { method: 'delete', path: '/api/browser/debugger/requests' },
      { method: 'post', path: '/api/browser/element-info' },
      { method: 'post', path: '/api/browser/click' },
      { method: 'get', path: '/api/browser/screenshot' },
    ]

    allRoutes.forEach(({ method, path }) => {
      it(`${method.toUpperCase()} ${path} exists (not 404)`, async () => {
        const res = await request(app)[method](path)
          .set('X-Auth-Token', AUTH_TOKEN)
        
        expect(res.status).not.toBe(404)
      })
    })

    // Test fill endpoint exists
    it('POST /api/browser/fill exists (not 404)', async () => {
      const res = await request(app)
        .post('/api/browser/fill')
        .set('X-Auth-Token', AUTH_TOKEN)
        .send({ selector: 'input', value: 'test' })
      
      expect(res.status).not.toBe(404)
      // Should be 503 (no extension connected)
      expect(res.status).toBe(503)
    })
  })
})

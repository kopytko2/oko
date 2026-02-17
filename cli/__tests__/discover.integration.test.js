import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { runDiscoverApi } from '../commands/discover.js'

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oko-discover-'))
  try {
    await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('discover api integration', () => {
  it('runs discovery, writes replay pack artifacts, and disables debugger', async () => {
    const calls = []
    const client = {
      async get(pathname) {
        calls.push(['get', pathname])

        if (pathname === '/api/browser/tabs') {
          return {
            success: true,
            tabs: [
              { id: 11, active: true, url: 'https://app.example.com/dashboard', title: 'Dashboard' },
            ],
          }
        }

        if (pathname === '/api/browser/debugger/requests') {
          return {
            success: true,
            requests: [
              {
                requestId: 'req-1',
                url: 'https://api.example.com/v1/users/123',
                method: 'GET',
                status: 200,
                timestamp: Date.now() - 500,
                requestHeaders: { authorization: 'Bearer abc123' },
                responseBody: '{"id":123,"name":"A"}',
                requestFingerprint: 'GET https://api.example.com/v1/users/{id} [XHR]',
              },
              {
                requestId: 'req-2',
                url: 'https://app.example.com/graphql',
                method: 'POST',
                status: 200,
                timestamp: Date.now() - 100,
                requestHeaders: { 'content-type': 'application/json' },
                requestBody: '{"operationName":"GetDashboard","query":"query GetDashboard{viewer{id}}"}',
                responseBody: '{"data":{"viewer":{"id":"u1"}}}',
                requestFingerprint: 'POST https://app.example.com/graphql [fetch]',
              },
            ],
            markers: [],
          }
        }

        throw new Error(`Unexpected GET ${pathname}`)
      },

      async post(pathname, body) {
        calls.push(['post', pathname, body])

        if (pathname === '/api/browser/debugger/enable') return { success: true }
        if (pathname === '/api/browser/debugger/disable') return { success: true }
        if (pathname === '/api/browser/debugger/mark') return { success: true, marker: { id: 'm1' } }
        if (pathname === '/api/browser/interactables') {
          return {
            success: true,
            items: [
              {
                selector: 'a.nav-users',
                tag: 'a',
                text: 'Users',
                href: '/users',
                visible: true,
                enabled: true,
              },
              {
                selector: 'input.search',
                tag: 'input',
                type: 'search',
                text: '',
                visible: true,
                enabled: true,
              },
            ],
          }
        }

        if (
          pathname === '/api/browser/hover' ||
          pathname === '/api/browser/click' ||
          pathname === '/api/browser/type' ||
          pathname === '/api/browser/key'
        ) {
          return { success: true }
        }

        throw new Error(`Unexpected POST ${pathname}`)
      },
    }

    await withTempDir(async (dir) => {
      const result = await runDiscoverApi({
        client,
        options: {
          tabId: undefined,
          tabUrl: undefined,
          active: true,
          budgetMin: 0.1,
          maxActions: 5,
          scope: 'first-party',
          outputDir: dir,
          allowPhase2: true,
          seedPath: undefined,
          includeHost: [],
          excludeHost: [],
          baselineMs: 0,
        },
        config: { url: 'http://localhost:8129' },
      })

      expect(result.success).toBe(true)
      expect(result.stats.endpointClusters).toBeGreaterThan(0)

      const expectedFiles = [
        'summary.json',
        'requests.ndjson',
        'endpoint-clusters.json',
        'dependencies.json',
        path.join('replay', 'templates.json'),
        path.join('replay', 'postman-collection.json'),
        'openapi.yaml',
        'openapi-report.json',
      ]

      for (const rel of expectedFiles) {
        const filePath = path.join(dir, rel)
        const stat = await fs.stat(filePath)
        expect(stat.isFile()).toBe(true)
      }

      const hasDisableCall = calls.some((entry) => entry[0] === 'post' && entry[1] === '/api/browser/debugger/disable')
      expect(hasDisableCall).toBe(true)
    })
  })
})

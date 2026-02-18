import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { runTestScenario } from '../commands/test.js'

async function withTempScenario(contents, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oko-scenario-'))
  const file = path.join(dir, 'scenario.yaml')
  await fs.writeFile(file, contents, 'utf8')
  try {
    await fn(file)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('test scenario runner integration', () => {
  it('executes scenario steps in order', async () => {
    const calls = []
    const client = {
      async post(pathname, body) {
        calls.push(['post', pathname, body])
        if (pathname === '/api/browser/wait') {
          return { success: true, matched: true, elapsedMs: 120 }
        }
        if (pathname === '/api/browser/assert') {
          return { success: true, passed: true, details: { ok: true } }
        }
        return { success: true }
      },
      async get(pathname, options) {
        calls.push(['get', pathname, options])
        if (pathname === '/api/browser/screenshot') {
          return { success: true, screenshot: 'data:image/png;base64,iVBORw0KGgo=' }
        }
        return { success: true }
      },
    }

    const yaml = `version: 1
defaults:
  timeoutMs: 6000
  pollMs: 150
  typingDelayMs: 20
steps:
  - navigate: { url: "https://example.com/login" }
  - wait: { condition: element, selector: "input[name=email]", state: visible }
  - type: { selector: "input[name=email]", text: "test@example.com", clear: true }
  - click: { selector: "button[type=submit]", mode: human }
  - assert: { urlIncludes: "/dashboard" }
`

    await withTempScenario(yaml, async (file) => {
      const result = await runTestScenario({
        client,
        options: {
          scenarioPath: file,
          tabId: 44,
          strict: true,
        },
      })

      expect(result.success).toBe(true)
      expect(result.totalSteps).toBe(5)
      expect(result.completedSteps).toBe(5)
      expect(calls).toHaveLength(5)
      expect(calls[0][1]).toBe('/api/browser/navigate')
      expect(calls[1][1]).toBe('/api/browser/wait')
      expect(calls[2][1]).toBe('/api/browser/type')
      expect(calls[3][1]).toBe('/api/browser/click')
      expect(calls[4][1]).toBe('/api/browser/assert')
      expect(calls.every((entry) => entry[2]?.tabId === 44)).toBe(true)
    })
  })

  it('fails and stops when assertion step fails', async () => {
    const calls = []
    const client = {
      async post(pathname) {
        calls.push(pathname)
        if (pathname === '/api/browser/assert') {
          return { success: true, passed: false, details: { reason: 'missing h1' } }
        }
        return { success: true, matched: true }
      },
      async get() {
        return { success: true }
      },
    }

    const yaml = `version: 1
steps:
  - wait: { condition: url, urlIncludes: "example.com" }
  - assert: { selector: "h1", textContains: "Dashboard" }
  - click: { selector: "button.next" }
`

    await withTempScenario(yaml, async (file) => {
      const result = await runTestScenario({
        client,
        options: {
          scenarioPath: file,
          strict: true,
        },
      })

      expect(result.success).toBe(false)
      expect(result.failedStep).toBe(2)
      expect(result.completedSteps).toBe(2)
      expect(calls).toEqual(['/api/browser/wait', '/api/browser/assert'])
    })
  })

  it('returns timeout-style wait failure details', async () => {
    const client = {
      async post(pathname) {
        if (pathname === '/api/browser/wait') {
          return { success: true, matched: false, elapsedMs: 5000, error: 'Condition not met within 5000ms' }
        }
        return { success: true }
      },
      async get() {
        return { success: true }
      },
    }

    const yaml = `version: 1
steps:
  - wait: { condition: element, selector: "#ready" }
`

    await withTempScenario(yaml, async (file) => {
      const result = await runTestScenario({
        client,
        options: {
          scenarioPath: file,
          strict: true,
        },
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Condition not met/i)
      expect(result.steps[0].success).toBe(false)
    })
  })

  it('uses background-first navigate default and reuses created tab for later steps', async () => {
    const calls = []
    const client = {
      async post(pathname, body) {
        calls.push(['post', pathname, body])
        if (pathname === '/api/browser/navigate') {
          return { success: true, tab: { id: 77, url: body.url } }
        }
        if (pathname === '/api/browser/wait') {
          return { success: true, matched: true, elapsedMs: 20 }
        }
        return { success: true }
      },
      async get() {
        return { success: true }
      },
    }

    const yaml = `version: 1
steps:
  - navigate: { url: "https://example.com/work" }
  - wait: { condition: url, urlIncludes: "example.com/work" }
`

    await withTempScenario(yaml, async (file) => {
      const result = await runTestScenario({
        client,
        options: {
          scenarioPath: file,
          strict: true,
        },
      })

      expect(result.success).toBe(true)
      expect(calls[0][1]).toBe('/api/browser/navigate')
      expect(calls[0][2].active).toBe(false)
      expect(calls[1][1]).toBe('/api/browser/wait')
      expect(calls[1][2].tabId).toBe(77)
    })
  })
})

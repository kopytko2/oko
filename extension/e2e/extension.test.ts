/**
 * E2E tests for Oko Chrome extension using Puppeteer
 * Tests the extension loaded in a real Chrome browser
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import puppeteer, { Browser, Page, Target, WebWorker } from 'puppeteer'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, ChildProcess } from 'child_process'
import http from 'http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '..')

// Get extension ID from manifest key or use calculated ID
// For unpacked extensions, Chrome generates ID from path
const EXTENSION_ID_PATTERN = /^[a-z]{32}$/

// Backend configuration
const BACKEND_PORT = 8131 // Use different port for E2E tests
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`

let browser: Browser
let backendProcess: ChildProcess | null = null
let authToken: string = ''

/**
 * Start the backend server for testing
 */
async function startBackend(): Promise<string> {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '../../backend/server.js')
    
    backendProcess = spawn('node', [serverPath], {
      env: {
        ...process.env,
        PORT: String(BACKEND_PORT),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let output = ''
    
    backendProcess.stdout?.on('data', (data) => {
      output += data.toString()
      // Look for the token in output
      const tokenMatch = output.match(/Token written to \/tmp\/oko-auth-token/)
      if (tokenMatch) {
        // Read token from file
        const fs = require('fs')
        try {
          authToken = fs.readFileSync('/tmp/oko-auth-token', 'utf-8').trim()
          resolve(authToken)
        } catch (e) {
          reject(new Error('Failed to read auth token'))
        }
      }
    })

    backendProcess.stderr?.on('data', (data) => {
      console.error('[Backend]', data.toString())
    })

    backendProcess.on('error', reject)
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!authToken) {
        reject(new Error('Backend startup timeout'))
      }
    }, 10000)
  })
}

/**
 * Stop the backend server
 */
function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM')
    backendProcess = null
  }
}

/**
 * Wait for backend to be ready
 */
async function waitForBackend(maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: BACKEND_PORT,
          path: '/api/health',
          method: 'GET',
          timeout: 1000,
        }, (res) => {
          if (res.statusCode === 200) {
            resolve()
          } else {
            reject(new Error(`Health check returned ${res.statusCode}`))
          }
        })
        req.on('error', reject)
        req.on('timeout', () => reject(new Error('Timeout')))
        req.end()
      })
      return
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error('Backend not ready after max attempts')
}

/**
 * Get the service worker target for the extension
 */
async function getServiceWorker(browser: Browser): Promise<WebWorker> {
  const target = await browser.waitForTarget(
    (t: Target) => t.type() === 'service_worker' && t.url().includes('chrome-extension://'),
    { timeout: 10000 }
  )
  const worker = await target.worker()
  if (!worker) {
    throw new Error('Failed to get service worker')
  }
  return worker
}

/**
 * Get the extension ID from the service worker URL
 */
function getExtensionId(worker: WebWorker): string {
  const url = worker.url()
  const match = url.match(/chrome-extension:\/\/([a-z]+)\//)
  if (!match) {
    throw new Error('Failed to extract extension ID from URL')
  }
  return match[1]
}

/**
 * Terminate the service worker
 */
async function terminateServiceWorker(browser: Browser, extensionId: string): Promise<void> {
  const target = await browser.waitForTarget(
    (t: Target) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extensionId}`),
    { timeout: 5000 }
  )
  const worker = await target.worker()
  if (worker) {
    await worker.close()
  }
}

describe('Oko Extension E2E Tests', () => {
  beforeAll(async () => {
    // Start backend
    await startBackend()
    await waitForBackend()
    console.log('[E2E] Backend started with token:', authToken.substring(0, 8) + '...')
  })

  afterAll(() => {
    stopBackend()
  })

  beforeEach(async () => {
    // Launch browser with extension
    browser = await puppeteer.launch({
      headless: 'new', // Use new headless mode that supports extensions
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    })
  })

  afterEach(async () => {
    if (browser) {
      await browser.close()
    }
  })

  describe('Extension Loading', () => {
    it('loads the extension successfully', async () => {
      const worker = await getServiceWorker(browser)
      expect(worker).toBeDefined()
      
      const extensionId = getExtensionId(worker)
      expect(extensionId).toMatch(EXTENSION_ID_PATTERN)
    })

    it('service worker is running', async () => {
      const worker = await getServiceWorker(browser)
      const url = worker.url()
      
      expect(url).toContain('chrome-extension://')
      expect(url).toContain('background.js')
    })
  })

  describe('Extension Popup', () => {
    it('can open popup page directly', async () => {
      const worker = await getServiceWorker(browser)
      const extensionId = getExtensionId(worker)
      
      const page = await browser.newPage()
      await page.goto(`chrome-extension://${extensionId}/popup.html`)
      
      // Check popup loaded
      const title = await page.title()
      expect(title).toBeDefined()
      
      // Check for connection status element
      const statusElement = await page.$('#status, .status, [data-status]')
      expect(statusElement).not.toBeNull()
    })

    it('popup shows disconnected state initially', async () => {
      const worker = await getServiceWorker(browser)
      const extensionId = getExtensionId(worker)
      
      const page = await browser.newPage()
      await page.goto(`chrome-extension://${extensionId}/popup.html`)
      
      // Wait for page to render
      await page.waitForSelector('body')
      
      // Get page content
      const content = await page.content()
      
      // Should show some form of disconnected/offline state
      const hasDisconnectedIndicator = 
        content.toLowerCase().includes('disconnect') ||
        content.toLowerCase().includes('offline') ||
        content.toLowerCase().includes('not connected')
      
      expect(hasDisconnectedIndicator).toBe(true)
    })
  })

  describe('Service Worker Termination', () => {
    it('service worker can be terminated', async () => {
      const worker = await getServiceWorker(browser)
      const extensionId = getExtensionId(worker)
      
      // Terminate the worker
      await terminateServiceWorker(browser, extensionId)
      
      // Wait a bit for termination
      await new Promise(r => setTimeout(r, 500))
      
      // Worker should restart when needed - try to get it again
      // This tests that the extension can recover from termination
      const newWorker = await getServiceWorker(browser)
      expect(newWorker).toBeDefined()
    })

    it('extension recovers state after service worker restart', async () => {
      const worker = await getServiceWorker(browser)
      const extensionId = getExtensionId(worker)
      
      // Open popup before termination
      const page = await browser.newPage()
      await page.goto(`chrome-extension://${extensionId}/popup.html`)
      await page.waitForSelector('body')
      
      // Terminate service worker
      await terminateServiceWorker(browser, extensionId)
      await new Promise(r => setTimeout(r, 1000))
      
      // Reload popup
      await page.reload()
      await page.waitForSelector('body')
      
      // Page should still work
      const content = await page.content()
      expect(content.length).toBeGreaterThan(100)
    })
  })

  describe('Backend Communication', () => {
    it('can reach backend health endpoint', async () => {
      const page = await browser.newPage()
      
      // Navigate to backend health endpoint
      const response = await page.goto(`${BACKEND_URL}/api/health`)
      
      expect(response?.status()).toBe(200)
      
      const body = await response?.json()
      expect(body.status).toBe('ok')
    })
  })
})

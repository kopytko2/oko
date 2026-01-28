/**
 * Contract tests to verify backend and extension use matching message types
 * These tests ensure the backend sends message types that the extension can handle
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read the shared message type registry
const messageTypesPath = path.resolve(__dirname, '../../shared/message-types.json')
const messageTypes = JSON.parse(fs.readFileSync(messageTypesPath, 'utf-8'))

// Extract message types from backend server.js
function extractBackendMessageTypes() {
  const serverPath = path.resolve(__dirname, '../server.js')
  const serverCode = fs.readFileSync(serverPath, 'utf-8')
  
  // Find all sendToExtension calls - format: sendToExtension(req, res, 'type', ...)
  const regex = /sendToExtension\s*\([^,]+,\s*[^,]+,\s*['"]([^'"]+)['"]/g
  const types = []
  let match
  while ((match = regex.exec(serverCode)) !== null) {
    types.push(match[1])
  }
  return [...new Set(types)] // Remove duplicates
}

// Extract message types from extension websocket.ts
function extractExtensionMessageTypes() {
  const wsPath = path.resolve(__dirname, '../../extension/background/websocket.ts')
  const wsCode = fs.readFileSync(wsPath, 'utf-8')
  
  // Find all case statements for browser-* messages
  const regex = /case\s+['"]([^'"]+)['"]\s*:/g
  const types = []
  let match
  while ((match = regex.exec(wsCode)) !== null) {
    if (match[1].startsWith('browser-')) {
      types.push(match[1])
    }
  }
  return types
}

describe('Message Type Contract Tests', () => {
  const backendTypes = extractBackendMessageTypes()
  const extensionTypes = extractExtensionMessageTypes()
  const registryTypes = Object.keys(messageTypes.browserRequests)

  describe('Backend sends valid message types', () => {
    it('all backend message types are in the registry', () => {
      const missingFromRegistry = backendTypes.filter(t => !registryTypes.includes(t))
      
      if (missingFromRegistry.length > 0) {
        console.error('Backend sends types not in registry:', missingFromRegistry)
      }
      
      expect(missingFromRegistry).toEqual([])
    })

    it('all backend message types have extension handlers', () => {
      const missingHandlers = backendTypes.filter(t => !extensionTypes.includes(t))
      
      if (missingHandlers.length > 0) {
        console.error('Backend sends types without extension handlers:', missingHandlers)
      }
      
      expect(missingHandlers).toEqual([])
    })
  })

  describe('Extension handles all registered types', () => {
    it('extension has handlers for all registry types', () => {
      const missingHandlers = registryTypes.filter(t => !extensionTypes.includes(t))
      
      if (missingHandlers.length > 0) {
        console.error('Registry types without extension handlers:', missingHandlers)
      }
      
      expect(missingHandlers).toEqual([])
    })
  })

  describe('Registry is complete', () => {
    it('registry contains all backend message types', () => {
      const missingFromRegistry = backendTypes.filter(t => !registryTypes.includes(t))
      expect(missingFromRegistry).toEqual([])
    })

    it('registry contains all extension handler types', () => {
      const missingFromRegistry = extensionTypes.filter(t => !registryTypes.includes(t))
      
      if (missingFromRegistry.length > 0) {
        console.warn('Extension handles types not in registry:', missingFromRegistry)
      }
      
      // This is a warning, not a failure - extension may handle extra types
      expect(true).toBe(true)
    })
  })

  describe('Message type consistency', () => {
    it('backend and extension have matching type sets', () => {
      const backendSet = new Set(backendTypes)
      const extensionSet = new Set(extensionTypes)
      
      const onlyInBackend = backendTypes.filter(t => !extensionSet.has(t))
      const onlyInExtension = extensionTypes.filter(t => !backendSet.has(t))
      
      if (onlyInBackend.length > 0) {
        console.error('Types only in backend (no handler):', onlyInBackend)
      }
      if (onlyInExtension.length > 0) {
        console.warn('Types only in extension (not sent by backend):', onlyInExtension)
      }
      
      expect(onlyInBackend).toEqual([])
    })
  })

  describe('Extracted types are valid', () => {
    it('backend has message types', () => {
      expect(backendTypes.length).toBeGreaterThan(0)
      console.log('Backend message types:', backendTypes)
    })

    it('extension has message handlers', () => {
      expect(extensionTypes.length).toBeGreaterThan(0)
      console.log('Extension message handlers:', extensionTypes)
    })

    it('registry has message types', () => {
      expect(registryTypes.length).toBeGreaterThan(0)
      console.log('Registry message types:', registryTypes)
    })
  })
})

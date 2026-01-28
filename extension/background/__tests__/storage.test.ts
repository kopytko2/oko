/**
 * Unit tests for storage module with Chrome API mocks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Chrome APIs before importing storage module
const mockSyncStorage: Record<string, unknown> = {}
const mockLocalStorage: Record<string, unknown> = {}
const mockChangeListeners: Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void> = []

const mockChrome = {
  storage: {
    sync: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, unknown> = {}
        for (const key of keys) {
          if (key in mockSyncStorage) {
            result[key] = mockSyncStorage[key]
          }
        }
        return result
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          const oldValue = mockSyncStorage[key]
          mockSyncStorage[key] = value
          // Trigger change listeners
          for (const listener of mockChangeListeners) {
            listener({ [key]: { oldValue, newValue: value } }, 'sync')
          }
        }
      }),
      clear: vi.fn(async () => {
        for (const key of Object.keys(mockSyncStorage)) {
          delete mockSyncStorage[key]
        }
      }),
    },
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, unknown> = {}
        for (const key of keys) {
          if (key in mockLocalStorage) {
            result[key] = mockLocalStorage[key]
          }
        }
        return result
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          const oldValue = mockLocalStorage[key]
          mockLocalStorage[key] = value
          // Trigger change listeners
          for (const listener of mockChangeListeners) {
            listener({ [key]: { oldValue, newValue: value } }, 'local')
          }
        }
      }),
      clear: vi.fn(async () => {
        for (const key of Object.keys(mockLocalStorage)) {
          delete mockLocalStorage[key]
        }
      }),
    },
    onChanged: {
      addListener: vi.fn((listener) => {
        mockChangeListeners.push(listener)
      }),
      removeListener: vi.fn((listener) => {
        const index = mockChangeListeners.indexOf(listener)
        if (index >= 0) {
          mockChangeListeners.splice(index, 1)
        }
      }),
    },
  },
}

// Set up global chrome mock
vi.stubGlobal('chrome', mockChrome)

// Now import the storage module
import {
  initStorage,
  getBackendUrl,
  setBackendUrl,
  getAuthToken,
  setAuthToken,
  getConnectionSettings,
  setConnectionSettings,
  clearStorage,
  isConfigured,
  onStorageChange,
} from '../storage'

describe('storage', () => {
  beforeEach(async () => {
    // Clear mock storage
    for (const key of Object.keys(mockSyncStorage)) {
      delete mockSyncStorage[key]
    }
    for (const key of Object.keys(mockLocalStorage)) {
      delete mockLocalStorage[key]
    }
    mockChangeListeners.length = 0
    
    // Clear mock call history
    vi.clearAllMocks()
    
    // Re-initialize storage
    await initStorage()
  })

  describe('initStorage', () => {
    it('loads initial values from chrome.storage', async () => {
      expect(mockChrome.storage.sync.get).toHaveBeenCalled()
      expect(mockChrome.storage.local.get).toHaveBeenCalled()
    })

    it('sets up change listener', async () => {
      expect(mockChrome.storage.onChanged.addListener).toHaveBeenCalled()
    })
  })

  describe('getBackendUrl / setBackendUrl', () => {
    it('returns empty string by default', () => {
      expect(getBackendUrl()).toBe('')
    })

    it('sets and gets backend URL', async () => {
      await setBackendUrl('https://example.com')
      
      expect(mockChrome.storage.sync.set).toHaveBeenCalledWith({
        backendUrl: 'https://example.com'
      })
      expect(getBackendUrl()).toBe('https://example.com')
    })
  })

  describe('getAuthToken / setAuthToken', () => {
    it('returns empty string by default', () => {
      expect(getAuthToken()).toBe('')
    })

    it('sets and gets auth token', async () => {
      await setAuthToken('test-token-123')
      
      expect(mockChrome.storage.local.set).toHaveBeenCalledWith({
        authToken: 'test-token-123'
      })
      expect(getAuthToken()).toBe('test-token-123')
    })
  })

  describe('getConnectionSettings', () => {
    it('returns both URL and token', async () => {
      await setBackendUrl('https://api.example.com')
      await setAuthToken('secret-token')
      
      const settings = getConnectionSettings()
      
      expect(settings).toEqual({
        backendUrl: 'https://api.example.com',
        authToken: 'secret-token'
      })
    })
  })

  describe('setConnectionSettings', () => {
    it('sets both URL and token', async () => {
      await setConnectionSettings('https://new-api.com', 'new-token')
      
      expect(getBackendUrl()).toBe('https://new-api.com')
      expect(getAuthToken()).toBe('new-token')
    })
  })

  describe('clearStorage', () => {
    it('clears all storage', async () => {
      await setBackendUrl('https://example.com')
      await setAuthToken('token')
      
      await clearStorage()
      
      expect(mockChrome.storage.sync.clear).toHaveBeenCalled()
      expect(mockChrome.storage.local.clear).toHaveBeenCalled()
      expect(getBackendUrl()).toBe('')
      expect(getAuthToken()).toBe('')
    })
  })

  describe('isConfigured', () => {
    it('returns false when URL is empty', () => {
      expect(isConfigured()).toBe(false)
    })

    it('returns true when URL is set', async () => {
      await setBackendUrl('https://example.com')
      expect(isConfigured()).toBe(true)
    })
  })

  describe('onStorageChange', () => {
    it('notifies listeners on storage change', async () => {
      const listener = vi.fn()
      onStorageChange(listener)
      
      await setBackendUrl('https://changed.com')
      
      expect(listener).toHaveBeenCalledWith({
        key: 'backendUrl',
        oldValue: undefined,
        newValue: 'https://changed.com'
      })
    })

    it('returns unsubscribe function', async () => {
      const listener = vi.fn()
      const unsubscribe = onStorageChange(listener)
      
      await setBackendUrl('https://first.com')
      expect(listener).toHaveBeenCalledTimes(1)
      
      unsubscribe()
      
      await setBackendUrl('https://second.com')
      expect(listener).toHaveBeenCalledTimes(1) // Still 1, not called again
    })
  })
})

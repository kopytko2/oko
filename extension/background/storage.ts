/**
 * Chrome storage wrapper
 * 
 * Centralizes all storage access to prevent scattered reads/writes.
 * Provides type-safe access and change notifications.
 */

import { createLogger } from './logger'

const log = createLogger('Storage')

// Storage keys and their types
export interface StorageSchema {
  // Sync storage (synced across devices)
  sync: {
    backendUrl: string
  }
  // Local storage (device-specific)
  local: {
    authToken: string
  }
}

// Default values
const DEFAULTS: { sync: StorageSchema['sync']; local: StorageSchema['local'] } = {
  sync: {
    backendUrl: 'http://localhost:8129'
  },
  local: {
    authToken: ''
  }
}

// Cached values to avoid repeated async reads
let cache: {
  sync: Partial<StorageSchema['sync']>
  local: Partial<StorageSchema['local']>
} = {
  sync: {},
  local: {}
}

// Change listeners
type StorageChangeListener = (changes: { key: string; oldValue: unknown; newValue: unknown }) => void
const changeListeners: Set<StorageChangeListener> = new Set()

/**
 * Initialize storage and set up change listeners
 */
export async function initStorage(): Promise<void> {
  // Load initial values into cache
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(Object.keys(DEFAULTS.sync)),
    chrome.storage.local.get(Object.keys(DEFAULTS.local))
  ])
  
  cache.sync = { ...DEFAULTS.sync, ...syncData }
  cache.local = { ...DEFAULTS.local, ...localData }
  
  log.debug('Storage initialized', { sync: cache.sync, local: '***' })
  
  // Listen for external changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const area = areaName as 'sync' | 'local'
    
    for (const [key, change] of Object.entries(changes)) {
      // Update cache
      if (area === 'sync' && key in DEFAULTS.sync) {
        (cache.sync as Record<string, unknown>)[key] = change.newValue
      } else if (area === 'local' && key in DEFAULTS.local) {
        (cache.local as Record<string, unknown>)[key] = change.newValue
      }
      
      // Notify listeners
      for (const listener of changeListeners) {
        try {
          listener({ key, oldValue: change.oldValue, newValue: change.newValue })
        } catch (e) {
          log.error('Storage change listener error', e instanceof Error ? e : undefined)
        }
      }
    }
  })
}

/**
 * Subscribe to storage changes
 */
export function onStorageChange(listener: StorageChangeListener): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

// Sync storage accessors

export function getBackendUrl(): string {
  return cache.sync.backendUrl ?? DEFAULTS.sync.backendUrl
}

export async function setBackendUrl(url: string): Promise<void> {
  await chrome.storage.sync.set({ backendUrl: url })
  cache.sync.backendUrl = url
  log.debug('Backend URL updated', { url })
}

// Local storage accessors

export function getAuthToken(): string {
  return cache.local.authToken ?? DEFAULTS.local.authToken
}

export async function setAuthToken(token: string): Promise<void> {
  await chrome.storage.local.set({ authToken: token })
  cache.local.authToken = token
  log.debug('Auth token updated')
}

/**
 * Get full connection settings (convenience method)
 */
export function getConnectionSettings(): { backendUrl: string; authToken: string } {
  return {
    backendUrl: getBackendUrl(),
    authToken: getAuthToken()
  }
}

/**
 * Set full connection settings (convenience method)
 */
export async function setConnectionSettings(url: string, token: string): Promise<void> {
  await Promise.all([
    setBackendUrl(url),
    setAuthToken(token)
  ])
}

/**
 * Clear all stored settings
 */
export async function clearStorage(): Promise<void> {
  await Promise.all([
    chrome.storage.sync.clear(),
    chrome.storage.local.clear()
  ])
  cache = { sync: { ...DEFAULTS.sync }, local: { ...DEFAULTS.local } }
  log.info('Storage cleared')
}

/**
 * Check if connection is configured
 */
export function isConfigured(): boolean {
  const url = getBackendUrl()
  return url !== '' && url !== DEFAULTS.sync.backendUrl
}

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getState,
  setConnecting,
  setConnected,
  setDisconnected,
  setReconnecting,
  updateQueueState,
  resetState,
  canReconnect,
  isConnected,
  subscribe,
} from '../connectionState'

// Mock the logger to avoid console output during tests
vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('connectionState', () => {
  beforeEach(() => {
    resetState()
  })

  describe('state transitions', () => {
    it('starts in disconnected state', () => {
      const state = getState()
      expect(state.connection.status).toBe('disconnected')
      expect(state.connection.reconnectAttempts).toBe(0)
    })

    it('transitions to connecting', () => {
      setConnecting('wss://example.com')
      const state = getState()
      expect(state.connection.status).toBe('connecting')
      expect(state.connection.url).toBe('wss://example.com')
    })

    it('transitions to connected and resets attempts', () => {
      setReconnecting(3)
      setConnected()
      const state = getState()
      expect(state.connection.status).toBe('connected')
      expect(state.connection.reconnectAttempts).toBe(0)
      expect(state.connection.lastConnectedAt).toBeGreaterThan(0)
    })

    it('transitions to disconnected with error', () => {
      setConnected()
      setDisconnected('Connection lost')
      const state = getState()
      expect(state.connection.status).toBe('disconnected')
      expect(state.connection.lastError).toBe('Connection lost')
    })

    it('tracks reconnect attempts', () => {
      setReconnecting(1)
      expect(getState().connection.reconnectAttempts).toBe(1)
      
      setReconnecting(2)
      expect(getState().connection.reconnectAttempts).toBe(2)
      
      setReconnecting(3)
      expect(getState().connection.reconnectAttempts).toBe(3)
    })
  })

  describe('canReconnect', () => {
    it('returns true when disconnected and under max attempts', () => {
      setDisconnected()
      expect(canReconnect(10)).toBe(true)
    })

    it('returns true when reconnecting and under max attempts', () => {
      setReconnecting(5)
      expect(canReconnect(10)).toBe(true)
    })

    it('returns false when connected', () => {
      setConnected()
      expect(canReconnect(10)).toBe(false)
    })

    it('returns false when at max attempts', () => {
      setReconnecting(10)
      expect(canReconnect(10)).toBe(false)
    })

    it('returns false when over max attempts', () => {
      setReconnecting(15)
      expect(canReconnect(10)).toBe(false)
    })
  })

  describe('isConnected', () => {
    it('returns false when disconnected', () => {
      expect(isConnected()).toBe(false)
    })

    it('returns false when connecting', () => {
      setConnecting('wss://example.com')
      expect(isConnected()).toBe(false)
    })

    it('returns true when connected', () => {
      setConnected()
      expect(isConnected()).toBe(true)
    })

    it('returns false when reconnecting', () => {
      setReconnecting(1)
      expect(isConnected()).toBe(false)
    })
  })

  describe('queue state', () => {
    it('updates queue state', () => {
      updateQueueState({
        length: 5,
        droppedCount: 2,
        oldestTimestamp: 1234567890,
      })
      
      const state = getState()
      expect(state.queue.length).toBe(5)
      expect(state.queue.droppedCount).toBe(2)
      expect(state.queue.oldestTimestamp).toBe(1234567890)
    })

    it('resets queue state on resetState', () => {
      updateQueueState({
        length: 5,
        droppedCount: 2,
        oldestTimestamp: 1234567890,
      })
      
      resetState()
      
      const state = getState()
      expect(state.queue.length).toBe(0)
      expect(state.queue.droppedCount).toBe(0)
      expect(state.queue.oldestTimestamp).toBeNull()
    })
  })

  describe('subscriptions', () => {
    it('notifies subscribers on state change', () => {
      const listener = vi.fn()
      subscribe(listener)
      
      setConnecting('wss://example.com')
      
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: expect.objectContaining({
            status: 'connecting',
          }),
        })
      )
    })

    it('allows unsubscribing', () => {
      const listener = vi.fn()
      const unsubscribe = subscribe(listener)
      
      setConnecting('wss://example.com')
      expect(listener).toHaveBeenCalledTimes(1)
      
      unsubscribe()
      
      setConnected()
      expect(listener).toHaveBeenCalledTimes(1) // Still 1, not called again
    })

    it('handles listener errors gracefully', () => {
      const badListener = vi.fn(() => {
        throw new Error('Listener error')
      })
      const goodListener = vi.fn()
      
      subscribe(badListener)
      subscribe(goodListener)
      
      // Should not throw
      setConnecting('wss://example.com')
      
      // Good listener should still be called
      expect(goodListener).toHaveBeenCalled()
    })
  })
})

/**
 * Unit tests for protocol message schemas and type guards
 */

import { describe, it, expect } from 'vitest'
import {
  isOutboundMessage,
  isInboundMessage,
  type IdentifyMessage,
  type PingMessage,
  type ElementSelectedMessage,
  type PongMessage,
  type HealthMessage,
  type BrowserMcpResultMessage,
} from '../protocol'

describe('protocol', () => {
  describe('isOutboundMessage', () => {
    it('returns true for identify message', () => {
      const msg: IdentifyMessage = { type: 'identify', clientType: 'extension' }
      expect(isOutboundMessage(msg)).toBe(true)
    })

    it('returns true for ping message', () => {
      const msg: PingMessage = { type: 'ping', ts: Date.now() }
      expect(isOutboundMessage(msg)).toBe(true)
    })

    it('returns true for element-selected message', () => {
      const msg: ElementSelectedMessage = {
        type: 'element-selected',
        element: {
          tagName: 'BUTTON',
          textContent: 'Click me',
        },
      }
      expect(isOutboundMessage(msg)).toBe(true)
    })

    it('returns false for null', () => {
      expect(isOutboundMessage(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isOutboundMessage(undefined)).toBe(false)
    })

    it('returns false for non-object', () => {
      expect(isOutboundMessage('string')).toBe(false)
      expect(isOutboundMessage(123)).toBe(false)
      expect(isOutboundMessage(true)).toBe(false)
    })

    it('returns false for object without type', () => {
      expect(isOutboundMessage({ foo: 'bar' })).toBe(false)
    })

    it('returns false for unknown type', () => {
      expect(isOutboundMessage({ type: 'unknown' })).toBe(false)
    })

    it('returns false for inbound message types', () => {
      expect(isOutboundMessage({ type: 'pong' })).toBe(false)
      expect(isOutboundMessage({ type: 'health' })).toBe(false)
    })
  })

  describe('isInboundMessage', () => {
    it('returns true for pong message', () => {
      const msg: PongMessage = { type: 'pong', ts: Date.now() }
      expect(isInboundMessage(msg)).toBe(true)
    })

    it('returns true for health message', () => {
      const msg: HealthMessage = { type: 'health', status: 'ok' }
      expect(isInboundMessage(msg)).toBe(true)
    })

    it('returns true for browser-* result messages', () => {
      const msg: BrowserMcpResultMessage = {
        type: 'browser-tabs-result',
        requestId: '123',
        success: true,
        data: [],
      }
      expect(isInboundMessage(msg)).toBe(true)
    })

    it('returns true for various browser message types', () => {
      expect(isInboundMessage({ type: 'browser-screenshot-result', requestId: '1', success: true })).toBe(true)
      expect(isInboundMessage({ type: 'browser-click-result', requestId: '2', success: true })).toBe(true)
      expect(isInboundMessage({ type: 'browser-navigate-result', requestId: '3', success: true })).toBe(true)
    })

    it('returns false for null', () => {
      expect(isInboundMessage(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isInboundMessage(undefined)).toBe(false)
    })

    it('returns false for non-object', () => {
      expect(isInboundMessage('string')).toBe(false)
      expect(isInboundMessage(123)).toBe(false)
    })

    it('returns false for object without type', () => {
      expect(isInboundMessage({ foo: 'bar' })).toBe(false)
    })

    it('returns false for outbound message types', () => {
      expect(isInboundMessage({ type: 'identify' })).toBe(false)
      expect(isInboundMessage({ type: 'ping' })).toBe(false)
    })
  })

  describe('message structure validation', () => {
    it('IdentifyMessage has correct structure', () => {
      const msg: IdentifyMessage = {
        type: 'identify',
        clientType: 'extension',
      }
      expect(msg.type).toBe('identify')
      expect(msg.clientType).toBe('extension')
    })

    it('PingMessage has correct structure', () => {
      const now = Date.now()
      const msg: PingMessage = {
        type: 'ping',
        ts: now,
      }
      expect(msg.type).toBe('ping')
      expect(msg.ts).toBe(now)
    })

    it('ElementSelectedMessage has correct structure', () => {
      const msg: ElementSelectedMessage = {
        type: 'element-selected',
        element: {
          tagName: 'DIV',
          id: 'main',
          className: 'container',
          textContent: 'Hello',
          selector: '#main',
          xpath: '/html/body/div',
          attributes: { 'data-test': 'value' },
        },
      }
      expect(msg.type).toBe('element-selected')
      expect(msg.element.tagName).toBe('DIV')
      expect(msg.element.id).toBe('main')
      expect(msg.element.attributes?.['data-test']).toBe('value')
    })

    it('BrowserMcpResultMessage handles success', () => {
      const msg: BrowserMcpResultMessage = {
        type: 'browser-tabs-result',
        requestId: 'req-123',
        success: true,
        data: [{ id: 1, url: 'https://example.com' }],
      }
      expect(msg.success).toBe(true)
      expect(msg.data).toBeDefined()
      expect(msg.error).toBeUndefined()
    })

    it('BrowserMcpResultMessage handles error', () => {
      const msg: BrowserMcpResultMessage = {
        type: 'browser-click-result',
        requestId: 'req-456',
        success: false,
        error: 'Element not found',
      }
      expect(msg.success).toBe(false)
      expect(msg.error).toBe('Element not found')
      expect(msg.data).toBeUndefined()
    })
  })
})

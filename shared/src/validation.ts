/**
 * Runtime validation utilities
 * 
 * Use these at message boundaries to ensure type safety.
 */

import { z } from 'zod'
import { BrowserRequest, BrowserResponse, ExtensionMessage } from './messages'

/**
 * Validate an incoming browser request from backend
 * Returns parsed message or throws ZodError
 */
export function validateBrowserRequest(data: unknown) {
  return BrowserRequest.parse(data)
}

/**
 * Safely validate browser request, returns null on failure
 */
export function safeParseBrowserRequest(data: unknown) {
  const result = BrowserRequest.safeParse(data)
  return result.success ? result.data : null
}

/**
 * Validate an outgoing browser response
 */
export function validateBrowserResponse(data: unknown) {
  return BrowserResponse.parse(data)
}

/**
 * Safely validate browser response
 */
export function safeParseBrowserResponse(data: unknown) {
  const result = BrowserResponse.safeParse(data)
  return result.success ? result.data : null
}

/**
 * Validate extension control message
 */
export function validateExtensionMessage(data: unknown) {
  return ExtensionMessage.parse(data)
}

/**
 * Check if a message looks like a browser request (has type starting with 'browser-')
 */
export function isBrowserRequest(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as { type?: string }
  return typeof msg.type === 'string' && msg.type.startsWith('browser-') && !msg.type.endsWith('-result')
}

/**
 * Check if a message looks like a browser response
 */
export function isBrowserResponse(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as { type?: string }
  return typeof msg.type === 'string' && msg.type.endsWith('-result')
}

/**
 * Check if message has a requestId (for request-response correlation)
 */
export function hasRequestId(data: unknown): data is { requestId: string } {
  if (typeof data !== 'object' || data === null) return false
  return typeof (data as { requestId?: unknown }).requestId === 'string'
}

/**
 * Create a typed error response for a request
 */
export function createErrorResponse(
  requestType: string,
  requestId: string,
  error: string
): { type: string; requestId: string; success: false; error: string } {
  return {
    type: `${requestType}-result`,
    requestId,
    success: false,
    error,
  }
}

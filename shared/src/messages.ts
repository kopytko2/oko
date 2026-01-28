/**
 * Oko Protocol Message Types
 * 
 * Discriminated unions for all WebSocket messages.
 * This is the single source of truth - if a message type changes here,
 * both backend and extension must be updated.
 */

import { z } from 'zod'

// =============================================================================
// PROTOCOL VERSION
// =============================================================================

/**
 * Protocol version for compatibility checking.
 * Increment MAJOR for breaking changes, MINOR for additions, PATCH for fixes.
 */
export const PROTOCOL_VERSION = '1.0.0'

export const ProtocolVersionSchema = z.object({
  major: z.number(),
  minor: z.number(),
  patch: z.number(),
})

export function parseProtocolVersion(version: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = version.split('.').map(Number)
  return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 }
}

export function isCompatibleVersion(clientVersion: string, serverVersion: string): boolean {
  const client = parseProtocolVersion(clientVersion)
  const server = parseProtocolVersion(serverVersion)
  // Major version must match for compatibility
  return client.major === server.major
}

// =============================================================================
// COMMON SCHEMAS
// =============================================================================

export const TabSchema = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string(),
  active: z.boolean().optional(),
  windowId: z.number().optional(),
  index: z.number().optional(),
})

export const ElementInfoSchema = z.object({
  tagName: z.string(),
  id: z.string().optional(),
  className: z.string().optional(),
  attributes: z.record(z.string()).optional(),
  innerText: z.string().optional(),
  innerHTML: z.string().optional(),
  outerHTML: z.string().optional(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  }).optional(),
  computedStyles: z.record(z.string()).optional(),
  isVisible: z.boolean().optional(),
  childCount: z.number().optional(),
})

export const NetworkRequestSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().optional(),
  statusText: z.string().optional(),
  requestHeaders: z.record(z.string()).optional(),
  responseHeaders: z.record(z.string()).optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  timestamp: z.number().optional(),
  duration: z.number().optional(),
  resourceType: z.string().optional(),
})

// =============================================================================
// BROWSER REQUEST MESSAGES (Backend -> Extension)
// =============================================================================

export const BrowserListTabsRequest = z.object({
  type: z.literal('browser-list-tabs'),
  requestId: z.string(),
})

export const BrowserNavigateRequest = z.object({
  type: z.literal('browser-navigate'),
  requestId: z.string(),
  url: z.string(),
  tabId: z.number().optional(),
  newTab: z.boolean().optional(),
  active: z.boolean().optional(),
})

export const BrowserScreenshotRequest = z.object({
  type: z.literal('browser-screenshot'),
  requestId: z.string(),
  tabId: z.number().optional(),
  fullPage: z.boolean().optional(),
})

export const BrowserGetElementInfoRequest = z.object({
  type: z.literal('browser-get-element-info'),
  requestId: z.string(),
  tabId: z.number().optional(),
  selector: z.string(),
  includeStyles: z.boolean().optional(),
  styleProperties: z.array(z.string()).nullable().optional(),
})

export const BrowserClickElementRequest = z.object({
  type: z.literal('browser-click-element'),
  requestId: z.string(),
  tabId: z.number().optional(),
  selector: z.string(),
})

export const BrowserFillInputRequest = z.object({
  type: z.literal('browser-fill-input'),
  requestId: z.string(),
  tabId: z.number().optional(),
  selector: z.string(),
  value: z.string(),
})

export const BrowserEnableNetworkCaptureRequest = z.object({
  type: z.literal('browser-enable-network-capture'),
  requestId: z.string(),
  tabId: z.number().optional(),
  urlFilter: z.array(z.string()).optional(),
})

export const BrowserDisableNetworkCaptureRequest = z.object({
  type: z.literal('browser-disable-network-capture'),
  requestId: z.string(),
})

export const BrowserGetNetworkRequestsRequest = z.object({
  type: z.literal('browser-get-network-requests'),
  requestId: z.string(),
  tabId: z.number().optional(),
  urlPattern: z.string().optional(),
  resourceType: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
})

export const BrowserEnableDebuggerCaptureRequest = z.object({
  type: z.literal('browser-enable-debugger-capture'),
  requestId: z.string(),
  tabId: z.number(),
  urlFilter: z.array(z.string()).optional(),
  maxRequests: z.number().optional(),
  captureBody: z.boolean().optional(),
})

export const BrowserDisableDebuggerCaptureRequest = z.object({
  type: z.literal('browser-disable-debugger-capture'),
  requestId: z.string(),
  tabId: z.number(),
})

export const BrowserGetDebuggerRequestsRequest = z.object({
  type: z.literal('browser-get-debugger-requests'),
  requestId: z.string(),
  tabId: z.number(),
  urlPattern: z.string().optional(),
  resourceType: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
})

export const BrowserClearDebuggerRequestsRequest = z.object({
  type: z.literal('browser-clear-debugger-requests'),
  requestId: z.string(),
  tabId: z.number(),
})

// Union of all browser requests
export const BrowserRequest = z.discriminatedUnion('type', [
  BrowserListTabsRequest,
  BrowserNavigateRequest,
  BrowserScreenshotRequest,
  BrowserGetElementInfoRequest,
  BrowserClickElementRequest,
  BrowserFillInputRequest,
  BrowserEnableNetworkCaptureRequest,
  BrowserDisableNetworkCaptureRequest,
  BrowserGetNetworkRequestsRequest,
  BrowserEnableDebuggerCaptureRequest,
  BrowserDisableDebuggerCaptureRequest,
  BrowserGetDebuggerRequestsRequest,
  BrowserClearDebuggerRequestsRequest,
])

// =============================================================================
// BROWSER RESPONSE MESSAGES (Extension -> Backend)
// =============================================================================

export const BrowserListTabsResponse = z.object({
  type: z.literal('browser-list-tabs-result'),
  requestId: z.string(),
  success: z.boolean(),
  tabs: z.array(TabSchema).optional(),
  error: z.string().optional(),
})

export const BrowserNavigateResponse = z.object({
  type: z.literal('browser-navigate-result'),
  requestId: z.string(),
  success: z.boolean(),
  tab: TabSchema.optional(),
  error: z.string().optional(),
})

export const BrowserScreenshotResponse = z.object({
  type: z.literal('browser-screenshot-result'),
  requestId: z.string(),
  success: z.boolean(),
  screenshot: z.string().optional(),
  error: z.string().optional(),
})

export const BrowserGetElementInfoResponse = z.object({
  type: z.literal('browser-get-element-info-result'),
  requestId: z.string(),
  success: z.boolean(),
  element: ElementInfoSchema.optional(),
  error: z.string().optional(),
})

export const BrowserClickElementResponse = z.object({
  type: z.literal('browser-click-element-result'),
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const BrowserFillInputResponse = z.object({
  type: z.literal('browser-fill-input-result'),
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const BrowserNetworkCaptureResponse = z.object({
  type: z.literal('browser-enable-network-capture-result'),
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const BrowserDisableNetworkCaptureResponse = z.object({
  type: z.literal('browser-disable-network-capture-result'),
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const BrowserGetNetworkRequestsResponse = z.object({
  type: z.literal('browser-get-network-requests-result'),
  requestId: z.string(),
  success: z.boolean(),
  requests: z.array(NetworkRequestSchema).optional(),
  error: z.string().optional(),
})

export const BrowserDebuggerCaptureResponse = z.object({
  type: z.literal('browser-enable-debugger-capture-result'),
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const BrowserDisableDebuggerCaptureResponse = z.object({
  type: z.literal('browser-disable-debugger-capture-result'),
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const BrowserGetDebuggerRequestsResponse = z.object({
  type: z.literal('browser-get-debugger-requests-result'),
  requestId: z.string(),
  success: z.boolean(),
  requests: z.array(NetworkRequestSchema).optional(),
  error: z.string().optional(),
})

export const BrowserClearDebuggerRequestsResponse = z.object({
  type: z.literal('browser-clear-debugger-requests-result'),
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

// Union of all browser responses
export const BrowserResponse = z.discriminatedUnion('type', [
  BrowserListTabsResponse,
  BrowserNavigateResponse,
  BrowserScreenshotResponse,
  BrowserGetElementInfoResponse,
  BrowserClickElementResponse,
  BrowserFillInputResponse,
  BrowserNetworkCaptureResponse,
  BrowserDisableNetworkCaptureResponse,
  BrowserGetNetworkRequestsResponse,
  BrowserDebuggerCaptureResponse,
  BrowserDisableDebuggerCaptureResponse,
  BrowserGetDebuggerRequestsResponse,
  BrowserClearDebuggerRequestsResponse,
])

// =============================================================================
// EXTENSION MESSAGES (Extension -> Backend, non-request)
// =============================================================================

export const AuthMessage = z.object({
  type: z.literal('auth'),
  token: z.string(),
})

export const AuthSuccessMessage = z.object({
  type: z.literal('auth-success'),
})

export const IdentifyMessage = z.object({
  type: z.literal('identify'),
  clientType: z.literal('extension'),
  protocolVersion: z.string().optional(), // Protocol version for compatibility checking
})

export const PingMessage = z.object({
  type: z.literal('ping'),
  ts: z.number().optional(),
})

export const PongMessage = z.object({
  type: z.literal('pong'),
  ts: z.number().optional(),
})

export const ElementSelectedMessage = z.object({
  type: z.literal('element-selected'),
  element: ElementInfoSchema,
})

// Union of extension control messages
export const ExtensionMessage = z.discriminatedUnion('type', [
  AuthMessage,
  IdentifyMessage,
  PingMessage,
  ElementSelectedMessage,
])

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Tab = z.infer<typeof TabSchema>
export type ElementInfo = z.infer<typeof ElementInfoSchema>
export type NetworkRequest = z.infer<typeof NetworkRequestSchema>

export type BrowserRequestType = z.infer<typeof BrowserRequest>
export type BrowserResponseType = z.infer<typeof BrowserResponse>
export type ExtensionMessageType = z.infer<typeof ExtensionMessage>

// All message types the extension can receive from backend
export type InboundMessage = BrowserRequestType

// All message types the extension can send to backend
export type OutboundMessage = BrowserResponseType | ExtensionMessageType

// =============================================================================
// MESSAGE TYPE CONSTANTS
// =============================================================================

export const BROWSER_REQUEST_TYPES = [
  'browser-list-tabs',
  'browser-navigate',
  'browser-screenshot',
  'browser-get-element-info',
  'browser-click-element',
  'browser-fill-input',
  'browser-enable-network-capture',
  'browser-disable-network-capture',
  'browser-get-network-requests',
  'browser-enable-debugger-capture',
  'browser-disable-debugger-capture',
  'browser-get-debugger-requests',
  'browser-clear-debugger-requests',
] as const

export type BrowserRequestTypeName = typeof BROWSER_REQUEST_TYPES[number]

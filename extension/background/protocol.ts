/**
 * WebSocket protocol message schemas
 * 
 * Defines all message types exchanged between extension and backend.
 */

// Outbound messages (extension -> backend)

export interface IdentifyMessage {
  type: 'identify'
  clientType: 'extension'
}

export interface PingMessage {
  type: 'ping'
  ts: number
}

export interface ElementSelectedMessage {
  type: 'element-selected'
  element: ElementInfo
}

export interface ElementInfo {
  tagName: string
  id?: string
  className?: string
  textContent?: string
  selector?: string
  xpath?: string
  attributes?: Record<string, string>
  rect?: DOMRect
  tabId?: number
}

export type OutboundMessage = 
  | IdentifyMessage 
  | PingMessage 
  | ElementSelectedMessage

// Inbound messages (backend -> extension)

export interface PongMessage {
  type: 'pong'
  ts: number
}

export interface HealthMessage {
  type: 'health'
  status: 'ok' | 'degraded'
}

export interface BrowserMcpResultMessage {
  type: `browser-${string}-result`
  requestId: string
  success: boolean
  data?: unknown
  error?: string
}

export type InboundMessage = 
  | PongMessage 
  | HealthMessage 
  | BrowserMcpResultMessage

// Internal extension messages (between background and popup/content scripts)

export interface WsConnectedMessage {
  type: 'WS_CONNECTED'
}

export interface WsDisconnectedMessage {
  type: 'WS_DISCONNECTED'
}

export interface ConnectionStatusMessage {
  type: 'CONNECTION_STATUS'
  connected: boolean
  state?: import('./connectionState').AppState
}

export interface BrowserMcpResultBroadcast {
  type: 'BROWSER_MCP_RESULT'
  data: BrowserMcpResultMessage
}

export interface WsMessageBroadcast {
  type: 'WS_MESSAGE'
  data: InboundMessage
}

export type InternalMessage =
  | WsConnectedMessage
  | WsDisconnectedMessage
  | ConnectionStatusMessage
  | BrowserMcpResultBroadcast
  | WsMessageBroadcast

// Type guards

export function isOutboundMessage(msg: unknown): msg is OutboundMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const type = (msg as { type?: string }).type
  return type === 'identify' || type === 'ping' || type === 'element-selected'
}

export function isInboundMessage(msg: unknown): msg is InboundMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const type = (msg as { type?: string }).type
  if (!type) return false
  return type === 'pong' || type === 'health' || type.startsWith('browser-')
}

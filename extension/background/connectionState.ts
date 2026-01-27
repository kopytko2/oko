/**
 * Connection state machine for Oko extension
 * 
 * Explicit states prevent "magic" scattered throughout the codebase.
 * All state transitions go through this module.
 */

import { createLogger } from './logger'

const log = createLogger('ConnectionState')

// Connection states
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

// Queue state
export interface QueueState {
  length: number
  droppedCount: number
  oldestTimestamp: number | null
}

// Full application state
export interface AppState {
  connection: {
    status: ConnectionStatus
    url: string | null
    lastConnectedAt: number | null
    lastError: string | null
    reconnectAttempts: number
  }
  queue: QueueState
  session: {
    token: string | null
    expiresAt: number | null
  }
}

// Initial state
const initialState: AppState = {
  connection: {
    status: 'disconnected',
    url: null,
    lastConnectedAt: null,
    lastError: null,
    reconnectAttempts: 0
  },
  queue: {
    length: 0,
    droppedCount: 0,
    oldestTimestamp: null
  },
  session: {
    token: null,
    expiresAt: null
  }
}

// Current state (module-level singleton)
let state: AppState = { ...initialState }

// Subscribers for state changes
type StateListener = (state: AppState) => void
const listeners: Set<StateListener> = new Set()

/**
 * Get current state (read-only copy)
 */
export function getState(): Readonly<AppState> {
  return state
}

/**
 * Subscribe to state changes
 */
export function subscribe(listener: StateListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(state)
    } catch (e) {
      log.error('State listener error', e instanceof Error ? e : undefined)
    }
  }
}

// State transition actions

export function setConnecting(url: string): void {
  log.info('Connecting', { url })
  state = {
    ...state,
    connection: {
      ...state.connection,
      status: 'connecting',
      url,
      lastError: null
    }
  }
  notifyListeners()
}

export function setConnected(): void {
  log.info('Connected')
  state = {
    ...state,
    connection: {
      ...state.connection,
      status: 'connected',
      lastConnectedAt: Date.now(),
      lastError: null,
      reconnectAttempts: 0
    }
  }
  notifyListeners()
}

export function setDisconnected(error?: string): void {
  log.info('Disconnected', { error })
  state = {
    ...state,
    connection: {
      ...state.connection,
      status: 'disconnected',
      lastError: error ?? null
    }
  }
  notifyListeners()
}

export function setReconnecting(attempt: number): void {
  log.info('Reconnecting', { attempt })
  state = {
    ...state,
    connection: {
      ...state.connection,
      status: 'reconnecting',
      reconnectAttempts: attempt
    }
  }
  notifyListeners()
}

export function updateQueueState(queue: QueueState): void {
  state = {
    ...state,
    queue
  }
  notifyListeners()
}

export function setSession(token: string | null, expiresAt: number | null): void {
  state = {
    ...state,
    session: { token, expiresAt }
  }
  notifyListeners()
}

export function resetState(): void {
  state = { ...initialState }
  notifyListeners()
}

/**
 * Check if we should attempt reconnection
 */
export function canReconnect(maxAttempts: number): boolean {
  return (
    state.connection.status !== 'connected' &&
    state.connection.reconnectAttempts < maxAttempts
  )
}

/**
 * Check if currently connected
 */
export function isConnected(): boolean {
  return state.connection.status === 'connected'
}

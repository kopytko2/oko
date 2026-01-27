/**
 * Centralized logging with levels and structured fields
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  component: string
  message: string
  data?: Record<string, unknown>
  error?: Error
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

// Default to 'info' in production, 'debug' in development
let currentLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

function formatLog(entry: LogEntry): string {
  const timestamp = new Date().toISOString()
  const prefix = `[${entry.component}]`
  let msg = `${timestamp} ${entry.level.toUpperCase()} ${prefix} ${entry.message}`
  
  if (entry.data) {
    msg += ` ${JSON.stringify(entry.data)}`
  }
  
  return msg
}

function log(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return
  
  const formatted = formatLog(entry)
  
  switch (entry.level) {
    case 'debug':
      console.debug(formatted)
      break
    case 'info':
      console.log(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    case 'error':
      console.error(formatted, entry.error || '')
      break
  }
}

export function createLogger(component: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => 
      log({ level: 'debug', component, message, data }),
    
    info: (message: string, data?: Record<string, unknown>) => 
      log({ level: 'info', component, message, data }),
    
    warn: (message: string, data?: Record<string, unknown>) => 
      log({ level: 'warn', component, message, data }),
    
    error: (message: string, error?: Error, data?: Record<string, unknown>) => 
      log({ level: 'error', component, message, data, error })
  }
}

/**
 * Error classification for handling policy
 */
export enum ErrorType {
  // Transient - retry with backoff
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  
  // Protocol - drop connection, surface to UI
  AUTH_FAILED = 'AUTH_FAILED',
  PROTOCOL_ERROR = 'PROTOCOL_ERROR',
  
  // Unexpected - report once, fail safe
  UNEXPECTED = 'UNEXPECTED'
}

export function classifyError(error: unknown): ErrorType {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
      return ErrorType.NETWORK_ERROR
    }
    if (msg.includes('timeout')) {
      return ErrorType.TIMEOUT
    }
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')) {
      return ErrorType.AUTH_FAILED
    }
    if (msg.includes('protocol') || msg.includes('invalid message')) {
      return ErrorType.PROTOCOL_ERROR
    }
  }
  
  return ErrorType.UNEXPECTED
}

/**
 * Backoff calculator for retries
 * Uses exponential backoff with jitter to prevent thundering herd
 */
export function calculateBackoff(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs)
  const jitter = Math.random() * 0.3 * exponential // 0-30% jitter
  return Math.floor(exponential + jitter)
}

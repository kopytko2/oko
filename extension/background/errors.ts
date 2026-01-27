/**
 * Error handling policy for Oko extension
 * 
 * Policy:
 * - Transient network errors: retry with exponential backoff + jitter
 * - Protocol errors: drop connection, update UI state, don't retry
 * - Unexpected errors: log once, fail safe, don't crash
 */

import { createLogger, classifyError, ErrorType, calculateBackoff } from './logger'

const log = createLogger('ErrorHandler')

// Track reported errors to avoid spam
const reportedErrors = new Set<string>()

export interface RetryConfig {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 10,
  baseDelayMs: 1000,
  maxDelayMs: 30000
}

/**
 * Handle an error according to policy
 * Returns true if the operation should be retried
 */
export function handleError(
  error: unknown, 
  context: string,
  attempt: number = 0,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): { shouldRetry: boolean; delayMs: number; errorType: ErrorType } {
  
  const errorType = classifyError(error)
  const errorKey = `${context}:${errorType}`
  
  switch (errorType) {
    case ErrorType.NETWORK_ERROR:
    case ErrorType.TIMEOUT:
      // Transient - retry with backoff
      if (attempt < config.maxAttempts) {
        const delayMs = calculateBackoff(attempt, config.baseDelayMs, config.maxDelayMs)
        log.warn(`${context}: transient error, will retry`, { 
          attempt, 
          delayMs, 
          error: error instanceof Error ? error.message : String(error) 
        })
        return { shouldRetry: true, delayMs, errorType }
      }
      log.error(`${context}: max retries exceeded`, error instanceof Error ? error : undefined)
      return { shouldRetry: false, delayMs: 0, errorType }
    
    case ErrorType.AUTH_FAILED:
    case ErrorType.PROTOCOL_ERROR:
      // Protocol error - don't retry, surface to UI
      log.error(`${context}: protocol error, not retrying`, error instanceof Error ? error : undefined)
      return { shouldRetry: false, delayMs: 0, errorType }
    
    case ErrorType.UNEXPECTED:
    default:
      // Unexpected - report once, fail safe
      if (!reportedErrors.has(errorKey)) {
        reportedErrors.add(errorKey)
        log.error(`${context}: unexpected error (reporting once)`, error instanceof Error ? error : undefined)
      }
      return { shouldRetry: false, delayMs: 0, errorType }
  }
}

/**
 * Wrap an async operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let attempt = 0
  
  while (true) {
    try {
      return await operation()
    } catch (error) {
      const result = handleError(error, context, attempt, config)
      
      if (!result.shouldRetry) {
        throw error
      }
      
      attempt++
      await new Promise(resolve => setTimeout(resolve, result.delayMs))
    }
  }
}

/**
 * Clear reported errors (useful for testing or after successful recovery)
 */
export function clearReportedErrors(): void {
  reportedErrors.clear()
}

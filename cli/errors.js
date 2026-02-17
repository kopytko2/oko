export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
    this.exitCode = 2
  }
}

export class OkoHttpError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'OkoHttpError'
    this.status = status
    this.body = body
  }
}

export class OkoNetworkError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'OkoNetworkError'
    this.cause = cause
  }
}

export class CliAbortError extends Error {
  constructor(message, exitCode = 130) {
    super(message)
    this.name = 'CliAbortError'
    this.exitCode = exitCode
  }
}

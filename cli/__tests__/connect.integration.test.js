import { describe, expect, it } from 'vitest'
import { parseConnectionCode } from '../connection-code.js'
import { runConnectCode } from '../commands/connect.js'

describe('connect code integration', () => {
  it('generates connection code from configured token', async () => {
    const result = await runConnectCode({
      client: {
        get: async () => {
          throw new Error('should not call token endpoint when token is configured')
        },
      },
      config: {
        url: 'https://8129--workspace.gitpod.dev',
        token: 'configured-token',
        tokenSource: 'flag',
      },
      options: { copy: false },
    })

    expect(result.success).toBe(true)
    expect(result.tokenSource).toBe('flag')
    expect(parseConnectionCode(result.connectionCode)).toEqual({
      url: 'https://8129--workspace.gitpod.dev',
      token: 'configured-token',
    })
  })

  it('fetches token from backend when not configured and supports clipboard copy', async () => {
    const result = await runConnectCode({
      client: {
        get: async (path) => {
          expect(path).toBe('/api/auth/token')
          return { token: 'fetched-token' }
        },
      },
      config: {
        url: 'http://localhost:8129',
        token: '',
        tokenSource: 'localhost_no_token',
      },
      options: { copy: true },
      copyFn: () => true,
    })

    expect(result.success).toBe(true)
    expect(result.copied).toBe(true)
    expect(result.tokenSource).toBe('api_auth_token')
    expect(parseConnectionCode(result.connectionCode)).toEqual({
      url: 'http://localhost:8129',
      token: 'fetched-token',
    })
  })
})

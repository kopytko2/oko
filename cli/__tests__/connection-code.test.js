import { describe, expect, it } from 'vitest'
import { generateConnectionCode } from '../../shared/dist/connectionCode.js'
import { parseConnectionCode } from '../connection-code.js'

describe('connection code parsing', () => {
  it('parses valid oko connection code', () => {
    const code = generateConnectionCode('https://example.com', 'secret-token')
    const parsed = parseConnectionCode(code)
    expect(parsed).toEqual({
      url: 'https://example.com',
      token: 'secret-token',
    })
  })

  it('returns null for invalid prefix', () => {
    expect(parseConnectionCode('not-oko')).toBeNull()
  })

  it('returns null for malformed payload', () => {
    expect(parseConnectionCode('oko:invalid@@@')).toBeNull()
  })
})

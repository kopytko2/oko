import { describe, expect, it } from 'vitest'
import { hintForError } from '../format.js'

describe('hintForError', () => {
  it('returns extension hint for 503', () => {
    expect(hintForError(503, 'No extension connected')).toMatch(/extension/i)
  })

  it('returns auth hint for 401', () => {
    expect(hintForError(401, 'Unauthorized')).toMatch(/token/i)
  })

  it('returns debugger hint for missing debugger session', () => {
    expect(hintForError(400, 'No debugger session for this tab')).toMatch(/debugger/i)
  })
})

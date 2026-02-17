import { describe, expect, it } from 'vitest'
import { parseCaptureApiOptions, parseCommand } from '../argparse.js'

describe('command argument validation', () => {
  it('rejects conflicting tab selectors', () => {
    expect(() => parseCaptureApiOptions(['--tab-id', '1', '--active'])).toThrow(/Choose only one/i)
  })

  it('rejects conflicting capture window options', () => {
    expect(() => parseCaptureApiOptions(['--duration', '10', '--until-enter'])).toThrow(/either --duration or --until-enter/i)
  })

  it('rejects follow with out file', () => {
    expect(() => parseCaptureApiOptions(['--follow', '--out', 'capture.json'])).toThrow(/cannot be combined/i)
  })

  it('parses low-level api post command', () => {
    const parsed = parseCommand(['api', 'post', '/api/browser/click', '--json', '{"tabId":1,"selector":"button"}'])
    expect(parsed.key).toBe('api.post')
    expect(parsed.options.path).toBe('/api/browser/click')
    expect(parsed.options.json).toEqual({ tabId: 1, selector: 'button' })
  })

  it('parses follow option for capture', () => {
    const parsed = parseCommand(['capture', 'api', '--follow', '--active'])
    expect(parsed.key).toBe('capture.api')
    expect(parsed.options.follow).toBe(true)
  })
})

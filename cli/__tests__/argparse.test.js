import { describe, expect, it } from 'vitest'
import {
  parseCaptureApiOptions,
  parseBrowserAssertOptions,
  parseBrowserWaitOptions,
  parseCommand,
  parseTestRunOptions,
} from '../argparse.js'

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

  it('parses browser type command', () => {
    const parsed = parseCommand([
      'browser',
      'type',
      '--tab-id',
      '3',
      '--selector',
      'input[name=email]',
      '--text',
      'test@example.com',
      '--clear',
      '--delay-ms',
      '40',
    ])

    expect(parsed.key).toBe('browser.type')
    expect(parsed.options).toMatchObject({
      tabId: 3,
      selector: 'input[name=email]',
      text: 'test@example.com',
      clear: true,
      delayMs: 40,
    })
  })

  it('validates browser wait condition arguments', () => {
    expect(() => parseBrowserWaitOptions(['--tab-id', '2', '--condition', 'url'])).toThrow(/url-includes/i)
  })

  it('validates browser assert has at least one condition', () => {
    expect(() => parseBrowserAssertOptions(['--tab-id', '2'])).toThrow(/at least one assertion/i)
  })

  it('parses test run command', () => {
    const parsed = parseCommand(['test', 'run', 'scenarios/login.yaml', '--tab-id', '8', '--strict'])
    expect(parsed.key).toBe('test.run')
    expect(parsed.options).toEqual({
      scenarioPath: 'scenarios/login.yaml',
      tabId: 8,
      strict: true,
    })
  })

  it('validates test run path requirement', () => {
    expect(() => parseTestRunOptions([])).toThrow(/scenario file path/i)
  })
})

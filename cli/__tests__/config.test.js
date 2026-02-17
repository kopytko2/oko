import fs from 'fs'
import { afterEach, describe, expect, it } from 'vitest'
import { generateConnectionCode } from '../../shared/dist/connectionCode.js'
import { resolveRuntimeConfig } from '../config.js'

const TOKEN_FILE = '/tmp/oko-auth-token'

let originalTokenFile = null
let tokenFileExisted = false

function saveTokenFile() {
  try {
    originalTokenFile = fs.readFileSync(TOKEN_FILE, 'utf8')
    tokenFileExisted = true
  } catch {
    originalTokenFile = null
    tokenFileExisted = false
  }
}

function restoreTokenFile() {
  if (tokenFileExisted) {
    fs.writeFileSync(TOKEN_FILE, originalTokenFile, 'utf8')
  } else {
    try {
      fs.unlinkSync(TOKEN_FILE)
    } catch {
      // ignore
    }
  }
}

afterEach(() => {
  restoreTokenFile()
})

describe('resolveRuntimeConfig', () => {
  it('uses explicit --token over connection code and env', () => {
    saveTokenFile()
    fs.writeFileSync(TOKEN_FILE, 'file-token', 'utf8')
    const code = generateConnectionCode('https://from-code.example', 'code-token')

    const config = resolveRuntimeConfig(
      {
        token: 'flag-token',
        connectionCode: code,
      },
      { OKO_AUTH_TOKEN: 'env-token' }
    )

    expect(config.url).toBe('https://from-code.example')
    expect(config.token).toBe('flag-token')
    expect(config.tokenSource).toBe('flag')
  })

  it('uses env token when no flag/code token is provided', () => {
    saveTokenFile()
    fs.writeFileSync(TOKEN_FILE, 'file-token', 'utf8')

    const config = resolveRuntimeConfig({}, { OKO_AUTH_TOKEN: 'env-token' })
    expect(config.token).toBe('env-token')
    expect(config.tokenSource).toBe('env')
  })

  it('falls back to token file when env is missing', () => {
    saveTokenFile()
    fs.writeFileSync(TOKEN_FILE, 'file-token', 'utf8')

    const config = resolveRuntimeConfig({}, {})
    expect(config.token).toBe('file-token')
    expect(config.tokenSource).toBe('file')
  })
})

import { spawnSync } from 'child_process'
import { UsageError } from '../errors.js'
import { isLocalUrl } from '../config.js'
import { generateConnectionCode } from '../connection-code.js'

function runClipboardCommand(command, args, text) {
  try {
    const result = spawnSync(command, args, {
      input: text,
      encoding: 'utf8',
    })
    if (result.status === 0) {
      return true
    }
  } catch {
    // Ignore and try next method.
  }
  return false
}

export function copyConnectionCodeToClipboard(code) {
  const platform = process.platform
  if (platform === 'darwin') {
    return runClipboardCommand('pbcopy', [], code)
  }
  if (platform === 'win32') {
    return runClipboardCommand('clip', [], code)
  }

  if (runClipboardCommand('wl-copy', [], code)) return true
  if (runClipboardCommand('xclip', ['-selection', 'clipboard'], code)) return true
  if (runClipboardCommand('xsel', ['--clipboard', '--input'], code)) return true
  return false
}

async function resolveTokenForConnectionCode({ client, config }) {
  if (config.token) {
    return { token: config.token, source: config.tokenSource }
  }

  try {
    const response = await client.get('/api/auth/token', { retry504: 0, omitAuth: true })
    if (response?.token && typeof response.token === 'string') {
      return { token: response.token, source: 'api_auth_token' }
    }
  } catch {
    // Fall through to validation error below.
  }

  if (isLocalUrl(config.url)) {
    throw new UsageError('Could not fetch local auth token from backend. Ensure backend is running and retry.')
  }
  throw new UsageError('No auth token available. Provide --token, --connection-code, OKO_AUTH_TOKEN, or /tmp/oko-auth-token.')
}

export async function runConnectCode({ client, config, options = {}, copyFn = copyConnectionCodeToClipboard }) {
  const { token, source } = await resolveTokenForConnectionCode({ client, config })
  const code = generateConnectionCode(config.url, token)

  let copied = false
  if (options.copy) {
    copied = Boolean(copyFn(code))
  }

  return {
    success: true,
    url: config.url,
    tokenSource: source,
    connectionCode: code,
    copied,
    copyRequested: Boolean(options.copy),
    hint: options.copy && !copied ? 'Clipboard copy failed. Copy the connectionCode value manually.' : undefined,
  }
}

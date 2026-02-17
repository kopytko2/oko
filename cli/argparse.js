import { UsageError } from './errors.js'

const GLOBAL_FLAGS = new Set([
  '--url',
  '--token',
  '--connection-code',
  '--timeout-ms',
  '--output',
  '--help',
  '-h',
])

function readOptionValue(argv, i, flag) {
  const current = argv[i]
  if (current.includes('=')) {
    return { value: current.split('=').slice(1).join('='), consumed: 1 }
  }
  if (i + 1 >= argv.length) {
    throw new UsageError(`${flag} requires a value`)
  }
  return { value: argv[i + 1], consumed: 2 }
}

function parseInteger(value, name) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new UsageError(`${name} must be an integer`)
  return n
}

function parsePositiveInteger(value, name) {
  const n = parseInteger(value, name)
  if (n <= 0) throw new UsageError(`${name} must be a positive integer`)
  return n
}

function parsePositiveNumber(value, name) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${name} must be a positive number`)
  return n
}

export function extractGlobalOptions(argv) {
  const global = {}
  const commandArgs = []

  for (let i = 0; i < argv.length; ) {
    const token = argv[i]

    if (!token.startsWith('-') || !GLOBAL_FLAGS.has(token.split('=')[0])) {
      commandArgs.push(token)
      i += 1
      continue
    }

    const key = token.split('=')[0]
    if (key === '--help' || key === '-h') {
      global.help = true
      i += 1
      continue
    }

    const { value, consumed } = readOptionValue(argv, i, key)
    if (key === '--url') global.url = value
    else if (key === '--token') global.token = value
    else if (key === '--connection-code') global.connectionCode = value
    else if (key === '--timeout-ms') global.timeoutMs = value
    else if (key === '--output') global.output = value

    i += consumed
  }

  return { globalOptions: global, commandArgs }
}

export function parseCommand(commandArgs) {
  if (commandArgs.length === 0) {
    return { key: 'help' }
  }

  const [group, action, ...rest] = commandArgs

  if (group === 'help') return { key: 'help' }
  if (group === 'doctor') {
    if (action) throw new UsageError('doctor does not take subcommands')
    return { key: 'doctor' }
  }

  if (group === 'tabs' && action === 'list') {
    if (rest.length > 0) throw new UsageError('tabs list takes no extra arguments')
    return { key: 'tabs.list' }
  }

  if (group === 'capture' && action === 'api') {
    return { key: 'capture.api', options: parseCaptureApiOptions(rest) }
  }

  if (group === 'browser') {
    if (action === 'screenshot') return { key: 'browser.screenshot', options: parseBrowserScreenshotOptions(rest) }
    if (action === 'click') return { key: 'browser.click', options: parseBrowserClickOptions(rest) }
    if (action === 'fill') return { key: 'browser.fill', options: parseBrowserFillOptions(rest) }
    throw new UsageError('browser command must be one of: screenshot, click, fill')
  }

  if (group === 'api') {
    if (!['get', 'post', 'delete'].includes(action)) {
      throw new UsageError('api command must be one of: get, post, delete')
    }
    return { key: `api.${action}`, options: parseLowLevelApiOptions(action, rest) }
  }

  throw new UsageError(`Unknown command: ${group}`)
}

export function parseCaptureApiOptions(args) {
  const options = {
    tabId: undefined,
    tabUrl: undefined,
    active: false,
    follow: false,
    mode: 'full',
    urlPattern: undefined,
    duration: undefined,
    untilEnter: false,
    maxRequests: 500,
    limit: 100,
    out: undefined,
  }

  for (let i = 0; i < args.length; ) {
    const token = args[i]
    if (token === '--active') {
      options.active = true
      i += 1
      continue
    }
    if (token === '--follow') {
      options.follow = true
      i += 1
      continue
    }
    if (token === '--until-enter') {
      options.untilEnter = true
      i += 1
      continue
    }

    if (
      token.startsWith('--tab-id') ||
      token.startsWith('--tab-url') ||
      token.startsWith('--mode') ||
      token.startsWith('--url-pattern') ||
      token.startsWith('--duration') ||
      token.startsWith('--max-requests') ||
      token.startsWith('--limit') ||
      token.startsWith('--out')
    ) {
      const flag = token.split('=')[0]
      const { value, consumed } = readOptionValue(args, i, flag)

      if (flag === '--tab-id') options.tabId = parsePositiveInteger(value, '--tab-id')
      else if (flag === '--tab-url') options.tabUrl = value
      else if (flag === '--mode') {
        if (!['safe', 'full'].includes(value)) {
          throw new UsageError("--mode must be 'safe' or 'full'")
        }
        options.mode = value
      } else if (flag === '--url-pattern') options.urlPattern = value
      else if (flag === '--duration') options.duration = parsePositiveNumber(value, '--duration')
      else if (flag === '--max-requests') options.maxRequests = parsePositiveInteger(value, '--max-requests')
      else if (flag === '--limit') options.limit = parsePositiveInteger(value, '--limit')
      else if (flag === '--out') options.out = value

      i += consumed
      continue
    }

    throw new UsageError(`Unknown capture option: ${token}`)
  }

  const selectors = [options.tabId !== undefined, !!options.tabUrl, options.active].filter(Boolean).length
  if (selectors > 1) {
    throw new UsageError('Choose only one of --tab-id, --tab-url, or --active')
  }

  if (options.duration !== undefined && options.untilEnter) {
    throw new UsageError('Use either --duration or --until-enter, not both')
  }

  if (options.follow && options.out) {
    throw new UsageError('--follow cannot be combined with --out (stream is written to stdout)')
  }

  if (selectors === 0) {
    options.active = true
  }

  if (options.duration === undefined && !options.untilEnter) {
    options.duration = 10
  }

  return options
}

export function parseBrowserScreenshotOptions(args) {
  const options = {
    tabId: undefined,
    fullPage: false,
  }

  for (let i = 0; i < args.length; ) {
    const token = args[i]
    if (token === '--full-page') {
      options.fullPage = true
      i += 1
      continue
    }
    if (token.startsWith('--tab-id')) {
      const { value, consumed } = readOptionValue(args, i, '--tab-id')
      options.tabId = parsePositiveInteger(value, '--tab-id')
      i += consumed
      continue
    }
    throw new UsageError(`Unknown screenshot option: ${token}`)
  }

  if (options.tabId === undefined) {
    throw new UsageError('--tab-id is required for browser screenshot')
  }

  return options
}

export function parseBrowserClickOptions(args) {
  const options = {
    tabId: undefined,
    selector: undefined,
  }

  for (let i = 0; i < args.length; ) {
    const token = args[i]
    if (token.startsWith('--tab-id')) {
      const { value, consumed } = readOptionValue(args, i, '--tab-id')
      options.tabId = parsePositiveInteger(value, '--tab-id')
      i += consumed
      continue
    }
    if (token.startsWith('--selector')) {
      const { value, consumed } = readOptionValue(args, i, '--selector')
      options.selector = value
      i += consumed
      continue
    }
    throw new UsageError(`Unknown click option: ${token}`)
  }

  if (options.tabId === undefined) throw new UsageError('--tab-id is required for browser click')
  if (!options.selector) throw new UsageError('--selector is required for browser click')
  return options
}

export function parseBrowserFillOptions(args) {
  const options = {
    tabId: undefined,
    selector: undefined,
    value: undefined,
  }

  for (let i = 0; i < args.length; ) {
    const token = args[i]
    if (token.startsWith('--tab-id')) {
      const { value, consumed } = readOptionValue(args, i, '--tab-id')
      options.tabId = parsePositiveInteger(value, '--tab-id')
      i += consumed
      continue
    }
    if (token.startsWith('--selector')) {
      const { value, consumed } = readOptionValue(args, i, '--selector')
      options.selector = value
      i += consumed
      continue
    }
    if (token.startsWith('--value')) {
      const { value, consumed } = readOptionValue(args, i, '--value')
      options.value = value
      i += consumed
      continue
    }
    throw new UsageError(`Unknown fill option: ${token}`)
  }

  if (options.tabId === undefined) throw new UsageError('--tab-id is required for browser fill')
  if (!options.selector) throw new UsageError('--selector is required for browser fill')
  if (options.value === undefined) throw new UsageError('--value is required for browser fill')
  return options
}

function parseQueryPairs(queryArgs) {
  const query = {}
  for (const entry of queryArgs) {
    const eq = entry.indexOf('=')
    if (eq === -1) throw new UsageError(`Invalid --query value: ${entry}. Expected k=v`)
    const key = entry.slice(0, eq)
    const value = entry.slice(eq + 1)
    if (!key) throw new UsageError(`Invalid --query value: ${entry}. Key is empty`)
    query[key] = value
  }
  return query
}

export function parseLowLevelApiOptions(method, args) {
  if (args.length === 0) {
    throw new UsageError(`api ${method} requires a path`)
  }

  const [path, ...rest] = args
  const options = {
    path,
    query: {},
    json: undefined,
  }

  const queryArgs = []

  for (let i = 0; i < rest.length; ) {
    const token = rest[i]

    if (token.startsWith('--query')) {
      const { value, consumed } = readOptionValue(rest, i, '--query')
      queryArgs.push(value)
      i += consumed
      continue
    }

    if (method === 'post' && token.startsWith('--json')) {
      const { value, consumed } = readOptionValue(rest, i, '--json')
      try {
        options.json = JSON.parse(value)
      } catch {
        throw new UsageError('--json must be valid JSON')
      }
      i += consumed
      continue
    }

    throw new UsageError(`Unknown api option: ${token}`)
  }

  options.query = parseQueryPairs(queryArgs)
  return options
}

export function getHelpText() {
  return `Oko CLI (agent-first)\n\nGlobal options:\n  --url <url>                Backend URL (default: http://localhost:8129)\n  --token <token>            Auth token\n  --connection-code <oko:..> Parse URL/token from connection code\n  --timeout-ms <n>           Request timeout in ms (default: 10000)\n  --output json|ndjson|text  Output format (default: json)\n  --help                     Show help\n\nCommands:\n  doctor\n  tabs list\n  capture api [--tab-id N | --tab-url REGEX | --active]\n              [--follow]\n              [--mode safe|full] [--url-pattern REGEX]\n              [--duration SEC | --until-enter]\n              [--max-requests N] [--limit N] [--out PATH]\n  browser screenshot --tab-id N [--full-page]\n  browser click --tab-id N --selector CSS\n  browser fill --tab-id N --selector CSS --value TEXT\n  api get <path> [--query k=v]\n  api post <path> [--json '{...}']\n  api delete <path> [--query k=v]\n\nNotes:\n  - capture api defaults to --mode full (captures sensitive headers/bodies)\n  - use --mode safe on sensitive targets\n  - --follow streams requests as NDJSON lines in real time\n`
}

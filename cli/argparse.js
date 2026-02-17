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

function parseFiniteNumber(value, name) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new UsageError(`${name} must be a finite number`)
  return n
}

function parseBoolean(value, name) {
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new UsageError(`${name} must be true or false`)
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

  if (group === 'discover' && action === 'api') {
    return { key: 'discover.api', options: parseDiscoverApiOptions(rest) }
  }

  if (group === 'browser') {
    if (action === 'screenshot') return { key: 'browser.screenshot', options: parseBrowserScreenshotOptions(rest) }
    if (action === 'click') return { key: 'browser.click', options: parseBrowserClickOptions(rest) }
    if (action === 'fill') return { key: 'browser.fill', options: parseBrowserFillOptions(rest) }
    if (action === 'hover') return { key: 'browser.hover', options: parseBrowserHoverOptions(rest) }
    if (action === 'type') return { key: 'browser.type', options: parseBrowserTypeOptions(rest) }
    if (action === 'key') return { key: 'browser.key', options: parseBrowserKeyOptions(rest) }
    if (action === 'scroll') return { key: 'browser.scroll', options: parseBrowserScrollOptions(rest) }
    if (action === 'wait') return { key: 'browser.wait', options: parseBrowserWaitOptions(rest) }
    if (action === 'assert') return { key: 'browser.assert', options: parseBrowserAssertOptions(rest) }
    throw new UsageError('browser command must be one of: screenshot, click, fill, hover, type, key, scroll, wait, assert')
  }

  if (group === 'test' && action === 'run') {
    return { key: 'test.run', options: parseTestRunOptions(rest) }
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

export function parseDiscoverApiOptions(args) {
  const options = {
    tabId: undefined,
    tabUrl: undefined,
    active: false,
    budgetMin: 8,
    maxActions: 80,
    scope: 'first-party',
    outputDir: undefined,
    allowPhase2: true,
    seedPath: undefined,
    format: 'json',
    includeHost: [],
    excludeHost: [],
  }

  for (let i = 0; i < args.length; ) {
    const token = args[i]
    if (token === '--active') {
      options.active = true
      i += 1
      continue
    }

    if (
      token.startsWith('--tab-id') ||
      token.startsWith('--tab-url') ||
      token.startsWith('--budget-min') ||
      token.startsWith('--max-actions') ||
      token.startsWith('--scope') ||
      token.startsWith('--output-dir') ||
      token.startsWith('--allow-phase2') ||
      token.startsWith('--seed-path') ||
      token.startsWith('--format') ||
      token.startsWith('--include-host') ||
      token.startsWith('--exclude-host')
    ) {
      const flag = token.split('=')[0]
      const { value, consumed } = readOptionValue(args, i, flag)

      if (flag === '--tab-id') options.tabId = parsePositiveInteger(value, '--tab-id')
      else if (flag === '--tab-url') options.tabUrl = value
      else if (flag === '--budget-min') options.budgetMin = parsePositiveNumber(value, '--budget-min')
      else if (flag === '--max-actions') options.maxActions = parsePositiveInteger(value, '--max-actions')
      else if (flag === '--scope') {
        if (!['first-party', 'origin', 'all'].includes(value)) {
          throw new UsageError("--scope must be 'first-party', 'origin', or 'all'")
        }
        options.scope = value
      } else if (flag === '--output-dir') options.outputDir = value
      else if (flag === '--allow-phase2') options.allowPhase2 = parseBoolean(value, '--allow-phase2')
      else if (flag === '--seed-path') options.seedPath = value
      else if (flag === '--format') {
        if (!['json', 'ndjson'].includes(value)) {
          throw new UsageError("--format must be 'json' or 'ndjson'")
        }
        options.format = value
      } else if (flag === '--include-host') options.includeHost.push(value)
      else if (flag === '--exclude-host') options.excludeHost.push(value)

      i += consumed
      continue
    }

    throw new UsageError(`Unknown discover option: ${token}`)
  }

  const selectors = [options.tabId !== undefined, !!options.tabUrl, options.active].filter(Boolean).length
  if (selectors > 1) {
    throw new UsageError('Choose only one of --tab-id, --tab-url, or --active')
  }
  if (selectors === 0) {
    options.active = true
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
    mode: 'human',
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
    if (token.startsWith('--mode')) {
      const { value, consumed } = readOptionValue(args, i, '--mode')
      if (!['human', 'native'].includes(value)) {
        throw new UsageError("--mode must be 'human' or 'native'")
      }
      options.mode = value
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

export function parseBrowserHoverOptions(args) {
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
    throw new UsageError(`Unknown hover option: ${token}`)
  }

  if (options.tabId === undefined) throw new UsageError('--tab-id is required for browser hover')
  if (!options.selector) throw new UsageError('--selector is required for browser hover')
  return options
}

export function parseBrowserTypeOptions(args) {
  const options = {
    tabId: undefined,
    selector: undefined,
    text: undefined,
    clear: false,
    delayMs: 35,
  }

  for (let i = 0; i < args.length; ) {
    const token = args[i]
    if (token === '--clear') {
      options.clear = true
      i += 1
      continue
    }
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
    if (token.startsWith('--text')) {
      const { value, consumed } = readOptionValue(args, i, '--text')
      options.text = value
      i += consumed
      continue
    }
    if (token.startsWith('--delay-ms')) {
      const { value, consumed } = readOptionValue(args, i, '--delay-ms')
      options.delayMs = parsePositiveInteger(value, '--delay-ms')
      i += consumed
      continue
    }
    throw new UsageError(`Unknown type option: ${token}`)
  }

  if (options.tabId === undefined) throw new UsageError('--tab-id is required for browser type')
  if (!options.selector) throw new UsageError('--selector is required for browser type')
  if (options.text === undefined) throw new UsageError('--text is required for browser type')
  return options
}

export function parseBrowserKeyOptions(args) {
  const options = {
    tabId: undefined,
    key: undefined,
    modifiers: [],
  }

  for (let i = 0; i < args.length; ) {
    const token = args[i]
    if (token.startsWith('--tab-id')) {
      const { value, consumed } = readOptionValue(args, i, '--tab-id')
      options.tabId = parsePositiveInteger(value, '--tab-id')
      i += consumed
      continue
    }
    if (token.startsWith('--key')) {
      const { value, consumed } = readOptionValue(args, i, '--key')
      options.key = value
      i += consumed
      continue
    }
    if (token.startsWith('--mod')) {
      const { value, consumed } = readOptionValue(args, i, '--mod')
      options.modifiers.push(value)
      i += consumed
      continue
    }
    throw new UsageError(`Unknown key option: ${token}`)
  }

  if (options.tabId === undefined) throw new UsageError('--tab-id is required for browser key')
  if (!options.key) throw new UsageError('--key is required for browser key')
  return options
}

export function parseBrowserScrollOptions(args) {
  const options = {
    tabId: undefined,
    selector: undefined,
    deltaX: undefined,
    deltaY: undefined,
    to: undefined,
    behavior: 'auto',
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
    if (token.startsWith('--delta-x')) {
      const { value, consumed } = readOptionValue(args, i, '--delta-x')
      options.deltaX = parseFiniteNumber(value, '--delta-x')
      i += consumed
      continue
    }
    if (token.startsWith('--delta-y')) {
      const { value, consumed } = readOptionValue(args, i, '--delta-y')
      options.deltaY = parseFiniteNumber(value, '--delta-y')
      i += consumed
      continue
    }
    if (token.startsWith('--to')) {
      const { value, consumed } = readOptionValue(args, i, '--to')
      if (!['top', 'bottom'].includes(value)) {
        throw new UsageError("--to must be 'top' or 'bottom'")
      }
      options.to = value
      i += consumed
      continue
    }
    if (token.startsWith('--behavior')) {
      const { value, consumed } = readOptionValue(args, i, '--behavior')
      if (!['auto', 'smooth'].includes(value)) {
        throw new UsageError("--behavior must be 'auto' or 'smooth'")
      }
      options.behavior = value
      i += consumed
      continue
    }
    throw new UsageError(`Unknown scroll option: ${token}`)
  }

  if (options.tabId === undefined) throw new UsageError('--tab-id is required for browser scroll')
  if (options.to === undefined && options.deltaX === undefined && options.deltaY === undefined) {
    throw new UsageError('browser scroll requires --to or --delta-x/--delta-y')
  }
  return options
}

export function parseBrowserWaitOptions(args) {
  const options = {
    tabId: undefined,
    condition: undefined,
    selector: undefined,
    state: 'visible',
    urlIncludes: undefined,
    timeoutMs: 5000,
    pollMs: 100,
  }

  for (let i = 0; i < args.length; ) {
    const token = args[i]
    if (token.startsWith('--tab-id')) {
      const { value, consumed } = readOptionValue(args, i, '--tab-id')
      options.tabId = parsePositiveInteger(value, '--tab-id')
      i += consumed
      continue
    }
    if (token.startsWith('--condition')) {
      const { value, consumed } = readOptionValue(args, i, '--condition')
      if (!['element', 'url'].includes(value)) {
        throw new UsageError("--condition must be 'element' or 'url'")
      }
      options.condition = value
      i += consumed
      continue
    }
    if (token.startsWith('--selector')) {
      const { value, consumed } = readOptionValue(args, i, '--selector')
      options.selector = value
      i += consumed
      continue
    }
    if (token.startsWith('--state')) {
      const { value, consumed } = readOptionValue(args, i, '--state')
      if (!['present', 'visible', 'hidden'].includes(value)) {
        throw new UsageError("--state must be 'present', 'visible', or 'hidden'")
      }
      options.state = value
      i += consumed
      continue
    }
    if (token.startsWith('--url-includes')) {
      const { value, consumed } = readOptionValue(args, i, '--url-includes')
      options.urlIncludes = value
      i += consumed
      continue
    }
    if (token.startsWith('--timeout-ms')) {
      const { value, consumed } = readOptionValue(args, i, '--timeout-ms')
      options.timeoutMs = parsePositiveInteger(value, '--timeout-ms')
      i += consumed
      continue
    }
    if (token.startsWith('--poll-ms')) {
      const { value, consumed } = readOptionValue(args, i, '--poll-ms')
      options.pollMs = parsePositiveInteger(value, '--poll-ms')
      i += consumed
      continue
    }
    throw new UsageError(`Unknown wait option: ${token}`)
  }

  if (options.tabId === undefined) throw new UsageError('--tab-id is required for browser wait')
  if (!options.condition) throw new UsageError('--condition is required for browser wait')
  if (options.condition === 'element' && !options.selector) {
    throw new UsageError('--selector is required when --condition element')
  }
  if (options.condition === 'url' && !options.urlIncludes) {
    throw new UsageError('--url-includes is required when --condition url')
  }
  return options
}

export function parseBrowserAssertOptions(args) {
  const options = {
    tabId: undefined,
    selector: undefined,
    visible: undefined,
    enabled: undefined,
    textContains: undefined,
    valueEquals: undefined,
    urlIncludes: undefined,
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
    if (token.startsWith('--visible')) {
      const { value, consumed } = readOptionValue(args, i, '--visible')
      options.visible = parseBoolean(value, '--visible')
      i += consumed
      continue
    }
    if (token.startsWith('--enabled')) {
      const { value, consumed } = readOptionValue(args, i, '--enabled')
      options.enabled = parseBoolean(value, '--enabled')
      i += consumed
      continue
    }
    if (token.startsWith('--text-contains')) {
      const { value, consumed } = readOptionValue(args, i, '--text-contains')
      options.textContains = value
      i += consumed
      continue
    }
    if (token.startsWith('--value-equals')) {
      const { value, consumed } = readOptionValue(args, i, '--value-equals')
      options.valueEquals = value
      i += consumed
      continue
    }
    if (token.startsWith('--url-includes')) {
      const { value, consumed } = readOptionValue(args, i, '--url-includes')
      options.urlIncludes = value
      i += consumed
      continue
    }
    throw new UsageError(`Unknown assert option: ${token}`)
  }

  if (options.tabId === undefined) throw new UsageError('--tab-id is required for browser assert')
  if (
    options.visible === undefined &&
    options.enabled === undefined &&
    options.textContains === undefined &&
    options.valueEquals === undefined &&
    options.urlIncludes === undefined
  ) {
    throw new UsageError('browser assert requires at least one assertion condition')
  }
  return options
}

export function parseTestRunOptions(args) {
  if (args.length === 0) {
    throw new UsageError('test run requires a scenario file path')
  }

  const [scenarioPath, ...rest] = args
  const options = {
    scenarioPath,
    tabId: undefined,
    strict: false,
  }

  for (let i = 0; i < rest.length; ) {
    const token = rest[i]
    if (token === '--strict') {
      options.strict = true
      i += 1
      continue
    }
    if (token.startsWith('--tab-id')) {
      const { value, consumed } = readOptionValue(rest, i, '--tab-id')
      options.tabId = parsePositiveInteger(value, '--tab-id')
      i += consumed
      continue
    }
    throw new UsageError(`Unknown test run option: ${token}`)
  }

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
  return `Oko CLI (agent-first)\n\nGlobal options:\n  --url <url>                Backend URL (default: http://localhost:8129)\n  --token <token>            Auth token\n  --connection-code <oko:..> Parse URL/token from connection code\n  --timeout-ms <n>           Request timeout in ms (default: 10000)\n  --output json|ndjson|text  Output format (default: json)\n  --help                     Show help\n\nCommands:\n  doctor\n  tabs list\n  discover api [--tab-id N | --tab-url REGEX | --active]\n               [--budget-min 8] [--max-actions 80]\n               [--scope first-party|origin|all]\n               [--output-dir PATH] [--allow-phase2 true|false]\n               [--seed-path /foo] [--format json|ndjson]\n               [--include-host REGEX] [--exclude-host REGEX]\n  capture api [--tab-id N | --tab-url REGEX | --active]\n              [--follow]\n              [--mode safe|full] [--url-pattern REGEX]\n              [--duration SEC | --until-enter]\n              [--max-requests N] [--limit N] [--out PATH]\n  browser screenshot --tab-id N [--full-page]\n  browser click --tab-id N --selector CSS [--mode human|native]\n  browser fill --tab-id N --selector CSS --value TEXT\n  browser hover --tab-id N --selector CSS\n  browser type --tab-id N --selector CSS --text TEXT [--clear] [--delay-ms N]\n  browser key --tab-id N --key KEY [--mod MODIFIER]\n  browser scroll --tab-id N [--selector CSS] [--delta-x N] [--delta-y N] [--to top|bottom] [--behavior auto|smooth]\n  browser wait --tab-id N --condition element|url [--selector CSS] [--state present|visible|hidden] [--url-includes TEXT] [--timeout-ms N] [--poll-ms N]\n  browser assert --tab-id N [--selector CSS] [--visible true|false] [--enabled true|false] [--text-contains TEXT] [--value-equals TEXT] [--url-includes TEXT]\n  test run <scenario.yaml> [--tab-id N] [--strict]\n  api get <path> [--query k=v]\n  api post <path> [--json '{...}']\n  api delete <path> [--query k=v]\n\nNotes:\n  - discover api runs autonomous two-phase exploration with policy-based safety guardrails\n  - capture api defaults to --mode full (captures sensitive headers/bodies)\n  - use --mode safe on sensitive targets\n  - --follow streams requests as NDJSON lines in real time\n`
}

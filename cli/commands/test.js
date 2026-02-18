import fs from 'fs/promises'
import { parse as parseYaml } from 'yaml'
import { UsageError } from '../errors.js'

const SUPPORTED_STEPS = new Set([
  'navigate',
  'wait',
  'hover',
  'click',
  'type',
  'key',
  'scroll',
  'assert',
  'screenshot',
])

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireObject(value, message) {
  if (!isObject(value)) {
    throw new UsageError(message)
  }
}

function requireString(value, message) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UsageError(message)
  }
}

function requireBoolean(value, message) {
  if (typeof value !== 'boolean') {
    throw new UsageError(message)
  }
}

function requirePositiveInteger(value, message) {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new UsageError(message)
  }
  return n
}

function validateKeys(payload, allowed, location, strict) {
  if (!strict) return
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw new UsageError(`${location} has unsupported key: ${key}`)
    }
  }
}

function normalizeDefaults(rawDefaults = {}, strict = false) {
  if (rawDefaults === undefined) {
    return {
      tab: 'active',
      timeoutMs: 5000,
      pollMs: 100,
      typingDelayMs: 35,
      profile: 'deterministic',
    }
  }

  requireObject(rawDefaults, 'scenario defaults must be an object')
  validateKeys(rawDefaults, new Set(['tab', 'timeoutMs', 'pollMs', 'typingDelayMs', 'profile']), 'defaults', strict)

  if (rawDefaults.tab !== undefined && rawDefaults.tab !== 'active' && typeof rawDefaults.tab !== 'number') {
    throw new UsageError('defaults.tab must be "active" or a tab ID number')
  }

  if (rawDefaults.timeoutMs !== undefined) {
    requirePositiveInteger(rawDefaults.timeoutMs, 'defaults.timeoutMs must be a positive integer')
  }

  if (rawDefaults.pollMs !== undefined) {
    requirePositiveInteger(rawDefaults.pollMs, 'defaults.pollMs must be a positive integer')
  }

  if (rawDefaults.typingDelayMs !== undefined) {
    requirePositiveInteger(rawDefaults.typingDelayMs, 'defaults.typingDelayMs must be a positive integer')
  }

  if (rawDefaults.profile !== undefined && rawDefaults.profile !== 'deterministic') {
    throw new UsageError('defaults.profile must be deterministic in MVP')
  }

  return {
    tab: rawDefaults.tab ?? 'active',
    timeoutMs: rawDefaults.timeoutMs ?? 5000,
    pollMs: rawDefaults.pollMs ?? 100,
    typingDelayMs: rawDefaults.typingDelayMs ?? 35,
    profile: rawDefaults.profile ?? 'deterministic',
  }
}

function validateStep(type, payload, index, strict) {
  const location = `steps[${index}]`
  requireObject(payload, `${location} payload must be an object`)

  switch (type) {
    case 'navigate': {
      validateKeys(payload, new Set(['url', 'tabId', 'newTab', 'active']), location, strict)
      requireString(payload.url, `${location}.navigate.url is required`)
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.navigate.tabId must be a positive integer`)
      if (payload.newTab !== undefined) requireBoolean(payload.newTab, `${location}.navigate.newTab must be boolean`)
      if (payload.active !== undefined) requireBoolean(payload.active, `${location}.navigate.active must be boolean`)
      break
    }
    case 'wait': {
      validateKeys(payload, new Set(['condition', 'selector', 'state', 'urlIncludes', 'timeoutMs', 'pollMs', 'tabId']), location, strict)
      if (payload.condition !== 'element' && payload.condition !== 'url') {
        throw new UsageError(`${location}.wait.condition must be element or url`)
      }
      if (payload.condition === 'element') {
        requireString(payload.selector, `${location}.wait.selector is required for element condition`)
      }
      if (payload.condition === 'url') {
        requireString(payload.urlIncludes, `${location}.wait.urlIncludes is required for url condition`)
      }
      if (payload.state !== undefined && !['present', 'visible', 'hidden'].includes(payload.state)) {
        throw new UsageError(`${location}.wait.state must be present, visible, or hidden`)
      }
      if (payload.timeoutMs !== undefined) requirePositiveInteger(payload.timeoutMs, `${location}.wait.timeoutMs must be a positive integer`)
      if (payload.pollMs !== undefined) requirePositiveInteger(payload.pollMs, `${location}.wait.pollMs must be a positive integer`)
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.wait.tabId must be a positive integer`)
      break
    }
    case 'hover': {
      validateKeys(payload, new Set(['selector', 'tabId']), location, strict)
      requireString(payload.selector, `${location}.hover.selector is required`)
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.hover.tabId must be a positive integer`)
      break
    }
    case 'click': {
      validateKeys(payload, new Set(['selector', 'mode', 'tabId']), location, strict)
      requireString(payload.selector, `${location}.click.selector is required`)
      if (payload.mode !== undefined && !['human', 'native'].includes(payload.mode)) {
        throw new UsageError(`${location}.click.mode must be human or native`)
      }
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.click.tabId must be a positive integer`)
      break
    }
    case 'type': {
      validateKeys(payload, new Set(['selector', 'text', 'clear', 'delayMs', 'tabId']), location, strict)
      requireString(payload.selector, `${location}.type.selector is required`)
      if (typeof payload.text !== 'string') {
        throw new UsageError(`${location}.type.text is required`)
      }
      if (payload.clear !== undefined) requireBoolean(payload.clear, `${location}.type.clear must be boolean`)
      if (payload.delayMs !== undefined) requirePositiveInteger(payload.delayMs, `${location}.type.delayMs must be a positive integer`)
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.type.tabId must be a positive integer`)
      break
    }
    case 'key': {
      validateKeys(payload, new Set(['key', 'modifiers', 'tabId']), location, strict)
      requireString(payload.key, `${location}.key.key is required`)
      if (payload.modifiers !== undefined) {
        if (!Array.isArray(payload.modifiers) || payload.modifiers.some((item) => typeof item !== 'string')) {
          throw new UsageError(`${location}.key.modifiers must be an array of strings`)
        }
      }
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.key.tabId must be a positive integer`)
      break
    }
    case 'scroll': {
      validateKeys(payload, new Set(['selector', 'deltaX', 'deltaY', 'to', 'behavior', 'tabId']), location, strict)
      if (payload.to !== undefined && !['top', 'bottom'].includes(payload.to)) {
        throw new UsageError(`${location}.scroll.to must be top or bottom`)
      }
      if (payload.behavior !== undefined && !['auto', 'smooth'].includes(payload.behavior)) {
        throw new UsageError(`${location}.scroll.behavior must be auto or smooth`)
      }
      if (payload.deltaX !== undefined && !Number.isFinite(payload.deltaX)) {
        throw new UsageError(`${location}.scroll.deltaX must be a finite number`)
      }
      if (payload.deltaY !== undefined && !Number.isFinite(payload.deltaY)) {
        throw new UsageError(`${location}.scroll.deltaY must be a finite number`)
      }
      if (payload.to === undefined && payload.deltaX === undefined && payload.deltaY === undefined) {
        throw new UsageError(`${location}.scroll requires to or deltaX/deltaY`)
      }
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.scroll.tabId must be a positive integer`)
      break
    }
    case 'assert': {
      validateKeys(payload, new Set(['selector', 'visible', 'enabled', 'textContains', 'valueEquals', 'urlIncludes', 'tabId']), location, strict)
      if (payload.visible !== undefined) requireBoolean(payload.visible, `${location}.assert.visible must be boolean`)
      if (payload.enabled !== undefined) requireBoolean(payload.enabled, `${location}.assert.enabled must be boolean`)
      if (payload.textContains !== undefined && typeof payload.textContains !== 'string') {
        throw new UsageError(`${location}.assert.textContains must be a string`)
      }
      if (payload.valueEquals !== undefined && typeof payload.valueEquals !== 'string') {
        throw new UsageError(`${location}.assert.valueEquals must be a string`)
      }
      if (payload.urlIncludes !== undefined && typeof payload.urlIncludes !== 'string') {
        throw new UsageError(`${location}.assert.urlIncludes must be a string`)
      }
      if (
        payload.visible === undefined &&
        payload.enabled === undefined &&
        payload.textContains === undefined &&
        payload.valueEquals === undefined &&
        payload.urlIncludes === undefined
      ) {
        throw new UsageError(`${location}.assert requires at least one assertion field`)
      }
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.assert.tabId must be a positive integer`)
      break
    }
    case 'screenshot': {
      validateKeys(payload, new Set(['tabId', 'fullPage', 'out']), location, strict)
      if (payload.tabId !== undefined) requirePositiveInteger(payload.tabId, `${location}.screenshot.tabId must be a positive integer`)
      if (payload.fullPage !== undefined) requireBoolean(payload.fullPage, `${location}.screenshot.fullPage must be boolean`)
      if (payload.out !== undefined && typeof payload.out !== 'string') {
        throw new UsageError(`${location}.screenshot.out must be a string path`)
      }
      break
    }
    default:
      throw new UsageError(`${location} has unsupported step type: ${type}`)
  }
}

export async function loadScenario(scenarioPath, strict = false) {
  const source = await fs.readFile(scenarioPath, 'utf8')

  let parsed
  try {
    parsed = parseYaml(source)
  } catch (err) {
    throw new UsageError(`Failed to parse scenario YAML: ${err instanceof Error ? err.message : String(err)}`)
  }

  requireObject(parsed, 'scenario root must be an object')
  if (parsed.version !== 1) {
    throw new UsageError('scenario version must be 1')
  }

  const defaults = normalizeDefaults(parsed.defaults, strict)

  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new UsageError('scenario steps must be a non-empty array')
  }

  const steps = parsed.steps.map((entry, index) => {
    requireObject(entry, `steps[${index}] must be an object with a single step type key`)
    const entries = Object.entries(entry)
    if (entries.length !== 1) {
      throw new UsageError(`steps[${index}] must have exactly one step type key`)
    }

    const [type, payload] = entries[0]
    if (!SUPPORTED_STEPS.has(type)) {
      throw new UsageError(`steps[${index}] has unsupported step type: ${type}`)
    }

    validateStep(type, payload, index, strict)
    return { type, payload }
  })

  return {
    version: 1,
    defaults,
    steps,
  }
}

function resolveTabId(cliTabId, defaults, stepPayload, sessionTabId) {
  if (cliTabId !== undefined) return cliTabId
  if (stepPayload && typeof stepPayload.tabId === 'number') return stepPayload.tabId
  if (typeof sessionTabId === 'number') return sessionTabId
  if (typeof defaults.tab === 'number') return defaults.tab
  return undefined
}

async function maybeWriteScreenshot(outPath, dataUrl) {
  if (!outPath || typeof dataUrl !== 'string' || dataUrl.length === 0) {
    return null
  }

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) {
    await fs.writeFile(outPath, dataUrl, 'utf8')
    return outPath
  }

  const base64 = match[2]
  const bytes = Buffer.from(base64, 'base64')
  await fs.writeFile(outPath, bytes)
  return outPath
}

async function executeStep({ client, step, defaults, cliTabId, sessionTabId }) {
  const tabId = resolveTabId(cliTabId, defaults, step.payload, sessionTabId)

  switch (step.type) {
    case 'navigate': {
      return client.post('/api/browser/navigate', {
        url: step.payload.url,
        tabId,
        newTab: step.payload.newTab,
        active: step.payload.active ?? false,
      })
    }
    case 'wait': {
      return client.post('/api/browser/wait', {
        tabId,
        condition: step.payload.condition,
        selector: step.payload.selector,
        state: step.payload.state || 'visible',
        urlIncludes: step.payload.urlIncludes,
        timeoutMs: step.payload.timeoutMs ?? defaults.timeoutMs,
        pollMs: step.payload.pollMs ?? defaults.pollMs,
      })
    }
    case 'hover': {
      return client.post('/api/browser/hover', {
        tabId,
        selector: step.payload.selector,
      })
    }
    case 'click': {
      return client.post('/api/browser/click', {
        tabId,
        selector: step.payload.selector,
        mode: step.payload.mode || 'human',
      })
    }
    case 'type': {
      return client.post('/api/browser/type', {
        tabId,
        selector: step.payload.selector,
        text: step.payload.text,
        clear: step.payload.clear === true,
        delayMs: step.payload.delayMs ?? defaults.typingDelayMs,
      })
    }
    case 'key': {
      return client.post('/api/browser/key', {
        tabId,
        key: step.payload.key,
        modifiers: step.payload.modifiers || [],
      })
    }
    case 'scroll': {
      return client.post('/api/browser/scroll', {
        tabId,
        selector: step.payload.selector,
        deltaX: step.payload.deltaX,
        deltaY: step.payload.deltaY,
        to: step.payload.to,
        behavior: step.payload.behavior || 'auto',
      })
    }
    case 'assert': {
      return client.post('/api/browser/assert', {
        tabId,
        selector: step.payload.selector,
        visible: step.payload.visible,
        enabled: step.payload.enabled,
        textContains: step.payload.textContains,
        valueEquals: step.payload.valueEquals,
        urlIncludes: step.payload.urlIncludes,
      })
    }
    case 'screenshot': {
      const response = await client.get('/api/browser/screenshot', {
        query: {
          tabId,
          fullPage: step.payload.fullPage === true,
        },
      })
      const out = await maybeWriteScreenshot(step.payload.out, response?.screenshot)
      return {
        ...response,
        out,
      }
    }
    default:
      throw new UsageError(`Unsupported step type: ${step.type}`)
  }
}

function isStepPassing(type, response) {
  if (response?.success === false) {
    return false
  }
  if (type === 'wait') {
    return response?.matched === true
  }
  if (type === 'assert') {
    return response?.passed === true
  }
  return true
}

function failureReason(type, response) {
  if (type === 'wait' && response?.matched !== true) {
    return response?.error || 'Wait condition was not matched before timeout'
  }
  if (type === 'assert' && response?.passed !== true) {
    return response?.error || 'Assertion failed'
  }
  if (response?.error) {
    return response.error
  }
  return 'Step failed'
}

export async function runTestScenario({ client, options }) {
  const scenario = await loadScenario(options.scenarioPath, options.strict === true)
  const startedAt = Date.now()
  const stepResults = []
  let sessionTabId = typeof options.tabId === 'number'
    ? options.tabId
    : (typeof scenario.defaults.tab === 'number' ? scenario.defaults.tab : undefined)

  for (let i = 0; i < scenario.steps.length; i += 1) {
    const step = scenario.steps[i]
    const stepStartedAt = Date.now()

    try {
      const result = await executeStep({
        client,
        step,
        defaults: scenario.defaults,
        cliTabId: options.tabId,
        sessionTabId,
      })

      if (
        step.type === 'navigate' &&
        options.tabId === undefined &&
        step.payload.tabId === undefined &&
        typeof result?.tab?.id === 'number'
      ) {
        sessionTabId = result.tab.id
      }

      const success = isStepPassing(step.type, result)
      stepResults.push({
        index: i + 1,
        type: step.type,
        success,
        elapsedMs: Date.now() - stepStartedAt,
        result,
      })

      if (!success) {
        return {
          success: false,
          scenario: options.scenarioPath,
          profile: scenario.defaults.profile,
          strict: options.strict === true,
          elapsedMs: Date.now() - startedAt,
          totalSteps: scenario.steps.length,
          completedSteps: stepResults.length,
          failedStep: i + 1,
          error: failureReason(step.type, result),
          steps: stepResults,
        }
      }
    } catch (err) {
      stepResults.push({
        index: i + 1,
        type: step.type,
        success: false,
        elapsedMs: Date.now() - stepStartedAt,
        error: err instanceof Error ? err.message : String(err),
      })

      return {
        success: false,
        scenario: options.scenarioPath,
        profile: scenario.defaults.profile,
        strict: options.strict === true,
        elapsedMs: Date.now() - startedAt,
        totalSteps: scenario.steps.length,
        completedSteps: stepResults.length,
        failedStep: i + 1,
        error: err instanceof Error ? err.message : String(err),
        steps: stepResults,
      }
    }
  }

  return {
    success: true,
    scenario: options.scenarioPath,
    profile: scenario.defaults.profile,
    strict: options.strict === true,
    elapsedMs: Date.now() - startedAt,
    totalSteps: scenario.steps.length,
    completedSteps: stepResults.length,
    steps: stepResults,
  }
}

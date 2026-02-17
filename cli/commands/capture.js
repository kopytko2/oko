import fs from 'fs/promises'
import readline from 'readline/promises'
import { CliAbortError, UsageError } from '../errors.js'
import { serializeForFile } from '../format.js'

const FOLLOW_POLL_INTERVAL_MS = 700

function isTabCandidate(tab) {
  return tab && typeof tab.id === 'number'
}

function selectTabByRegex(tabs, rawPattern) {
  let regex
  try {
    regex = new RegExp(rawPattern, 'i')
  } catch {
    throw new UsageError('--tab-url must be a valid regular expression')
  }

  const activeMatch = tabs.find((tab) => tab.active && regex.test(tab.url || ''))
  if (activeMatch) return activeMatch
  return tabs.find((tab) => regex.test(tab.url || ''))
}

export async function resolveCaptureTabId(client, options) {
  if (options.tabId !== undefined) {
    return options.tabId
  }

  const response = await client.get('/api/browser/tabs')
  const tabs = Array.isArray(response?.tabs) ? response.tabs.filter(isTabCandidate) : []
  if (tabs.length === 0) {
    throw new UsageError('No tabs available. Open a tab and try again.')
  }

  if (options.tabUrl) {
    const selected = selectTabByRegex(tabs, options.tabUrl)
    if (!selected) {
      throw new UsageError(`No tab matched --tab-url pattern: ${options.tabUrl}`)
    }
    return selected.id
  }

  if (options.active) {
    const selected = tabs.find((tab) => tab.active) || tabs[0]
    return selected.id
  }

  return tabs[0].id
}

export async function waitForCaptureWindow(options, io, abortSignal) {
  if (options.untilEnter) {
    if (!io.stdin.isTTY) {
      throw new UsageError('--until-enter requires an interactive TTY')
    }

    const rl = readline.createInterface({ input: io.stdin, output: io.stdout })
    const abortPromise = new Promise((_, reject) => {
      if (abortSignal.aborted) {
        reject(new CliAbortError('Interrupted'))
        return
      }
      const onAbort = () => {
        abortSignal.removeEventListener('abort', onAbort)
        reject(new CliAbortError('Interrupted'))
      }
      abortSignal.addEventListener('abort', onAbort)
    })

    try {
      await Promise.race([
        rl.question('Capturing... Press Enter to stop.\n'),
        abortPromise,
      ])
    } finally {
      rl.close()
    }
    return
  }

  const durationMs = Math.round((options.duration || 0) * 1000)
  await new Promise((resolve, reject) => {
    if (abortSignal.aborted) {
      reject(new CliAbortError('Interrupted'))
      return
    }

    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)

    const onAbort = () => {
      clearTimeout(timer)
      abortSignal.removeEventListener('abort', onAbort)
      reject(new CliAbortError('Interrupted'))
    }

    abortSignal.addEventListener('abort', onAbort)
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchDebuggerRequests(client, tabId, options) {
  const result = await client.get('/api/browser/debugger/requests', {
    query: {
      tabId,
      urlPattern: options.urlPattern,
      limit: options.maxRequests,
    },
  })
  return Array.isArray(result?.requests) ? result.requests : []
}

function requestKey(req, fallbackIndex) {
  if (req?.requestId) return String(req.requestId)
  const method = req?.method || ''
  const url = req?.url || ''
  const ts = req?.timestamp || ''
  return `${method}|${url}|${ts}|${fallbackIndex}`
}

async function streamFollowLoop({ client, tabId, options, io, shouldStop, abortSignal, pollIntervalMs = FOLLOW_POLL_INTERVAL_MS }) {
  const seen = new Set()
  let emitted = 0

  const emitBatch = async () => {
    const requests = await fetchDebuggerRequests(client, tabId, options)
    const unseen = []
    for (let i = 0; i < requests.length; i += 1) {
      const req = requests[i]
      const key = requestKey(req, i)
      if (!seen.has(key)) {
        seen.add(key)
        unseen.push(req)
      }
    }

    unseen.reverse()
    for (const req of unseen) {
      io.stdout.write(`${JSON.stringify(req)}\n`)
      emitted += 1
    }
  }

  while (true) {
    if (abortSignal.aborted) break
    try {
      await emitBatch()
    } catch {
      // Keep streaming best-effort.
    }

    if (shouldStop()) break
    await delay(pollIntervalMs)
  }

  // Final flush after stop to avoid dropping trailing requests.
  if (!abortSignal.aborted) {
    try {
      await emitBatch()
    } catch {
      // Best effort.
    }
  }

  return emitted
}

export async function runCaptureApi({ client, options, output, io, processRef = process }) {
  const tabId = await resolveCaptureTabId(client, options)
  const controller = new AbortController()

  let captureEnabled = false
  let interruptedBy = null

  const onSigint = () => {
    interruptedBy = 'SIGINT'
    controller.abort()
  }
  const onSigterm = () => {
    interruptedBy = 'SIGTERM'
    controller.abort()
  }

  processRef.once('SIGINT', onSigint)
  processRef.once('SIGTERM', onSigterm)

  try {
    await client.post('/api/browser/debugger/enable', {
      tabId,
      mode: options.mode,
      maxRequests: options.maxRequests,
      captureBody: options.mode === 'full',
      urlFilter: options.urlPattern ? [options.urlPattern] : undefined,
    })
    captureEnabled = true

    let followShouldStop = false
    const followPromise = options.follow
      ? streamFollowLoop({
        client,
        tabId,
        options,
        io,
        shouldStop: () => followShouldStop,
        abortSignal: controller.signal,
        pollIntervalMs: options.followPollMs || FOLLOW_POLL_INTERVAL_MS,
      })
      : null
    let streamedCount = 0

    try {
      await waitForCaptureWindow(options, io, controller.signal)
    } finally {
      followShouldStop = true
      if (followPromise) {
        try {
          streamedCount = await followPromise
        } catch {
          // Keep cleanup resilient if polling loop fails.
        }
      }
    }

    if (options.follow) {
      return {
        success: true,
        tabId,
        mode: options.mode,
        streamed: true,
        streamedCount,
        _skipOutput: true,
      }
    }

    const result = await client.get('/api/browser/debugger/requests', {
      query: {
        tabId,
        urlPattern: options.urlPattern,
        limit: options.limit,
      },
    })

    const requests = Array.isArray(result?.requests) ? result.requests : []
    const responsePayload = {
      success: true,
      tabId,
      mode: options.mode,
      urlPattern: options.urlPattern || null,
      total: typeof result?.total === 'number' ? result.total : requests.length,
      limit: options.limit,
      requests,
    }

    if (options.out) {
      await fs.writeFile(options.out, serializeForFile(responsePayload, output), 'utf8')
      return {
        success: true,
        tabId,
        mode: options.mode,
        total: responsePayload.total,
        out: options.out,
      }
    }

    return responsePayload
  } finally {
    processRef.removeListener('SIGINT', onSigint)
    processRef.removeListener('SIGTERM', onSigterm)

    if (captureEnabled) {
      try {
        await client.post('/api/browser/debugger/disable', { tabId })
      } catch {
        // Best effort cleanup.
      }
    }

    if (interruptedBy) {
      throw new CliAbortError(`Interrupted by ${interruptedBy}`, interruptedBy === 'SIGINT' ? 130 : 143)
    }
  }
}

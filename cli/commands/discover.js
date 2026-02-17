import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { stringify as stringifyYaml } from 'yaml'
import { UsageError } from '../errors.js'
import { resolveCaptureTabId } from './capture.js'

const HIGH_RISK_KEYWORDS = [
  'delete',
  'remove',
  'purchase',
  'checkout',
  'pay',
  'billing',
  'transfer',
  'invite',
  'upload',
  'create account',
]

const SAFE_MUTATION_INTENTS = new Set([
  'search',
  'filter',
  'sort',
  'view',
  'expand',
  'next',
  'apply',
  'refresh',
])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function parseUrlSafe(raw) {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function getRegistrableDomain(hostname = '') {
  const host = hostname.toLowerCase()
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host

  const secondLevelSet = new Set(['co', 'com', 'org', 'net', 'gov', 'edu'])
  const last = parts[parts.length - 1]
  const secondLast = parts[parts.length - 2]
  if (last.length === 2 && secondLevelSet.has(secondLast) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return parts.slice(-2).join('.')
}

function compileRegexList(patterns = []) {
  const compiled = []
  for (const raw of patterns) {
    try {
      compiled.push(new RegExp(raw, 'i'))
    } catch {
      // Ignore invalid regex entries to keep discovery resilient.
    }
  }
  return compiled
}

function normalizePathname(pathname) {
  return pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment
      if (/^\d+$/.test(segment)) return '{id}'
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return '{uuid}'
      if (/^[0-9a-f]{24,}$/i.test(segment)) return '{hex}'
      if (/^[A-Za-z0-9_-]{20,}$/.test(segment)) return '{token}'
      return segment
    })
    .join('/')
}

function redactDynamicValue(value) {
  if (!value) return value
  let output = String(value)
  output = output.replace(/[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, '{{jwt}}')
  output = output.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '{{uuid}}')
  output = output.replace(/[0-9a-f]{24,}/gi, '{{hex}}')
  output = output.replace(/\b\d{10,}\b/g, '{{timestamp}}')
  output = output.replace(/\b\d+\b/g, '{{number}}')
  return output
}

function detectGraphqlOperation(request) {
  const body = request?.requestBody
  if (!body || typeof body !== 'string') return null

  try {
    const parsed = JSON.parse(body)
    if (typeof parsed.operationName === 'string' && parsed.operationName) {
      return parsed.operationName
    }
    if (typeof parsed.query === 'string') {
      const match = parsed.query.match(/\b(query|mutation|subscription)\s+([A-Za-z0-9_]+)/)
      if (match?.[2]) return match[2]
    }
  } catch {
    // Ignore parse errors.
  }

  return null
}

function pickContentType(request) {
  const headers = request?.requestHeaders || {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type') return String(value)
  }
  return null
}

function hostFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname
  } catch {
    return ''
  }
}

function evaluateActionIntent(node) {
  const text = `${node.text || ''} ${node.ariaLabel || ''} ${node.href || ''}`.toLowerCase()
  if (text.includes('search')) return 'search'
  if (text.includes('filter')) return 'filter'
  if (text.includes('sort')) return 'sort'
  if (text.includes('next') || text.includes('more')) return 'next'
  if (text.includes('expand') || text.includes('show')) return 'expand'
  if (text.includes('refresh')) return 'refresh'
  if (text.includes('view')) return 'view'
  if (text.includes('apply')) return 'apply'
  return 'generic'
}

function computeRiskScore(node) {
  const text = `${node.text || ''} ${node.ariaLabel || ''} ${node.href || ''}`.toLowerCase()
  let score = 0

  for (const keyword of HIGH_RISK_KEYWORDS) {
    if (text.includes(keyword)) {
      score += 45
    }
  }

  if (node.type === 'password' || node.type === 'file') score += 35
  if (node.tag === 'button' && /submit|save|confirm/.test(text)) score += 25
  if (node.formContext?.method && node.formContext.method.toLowerCase() !== 'get') score += 20
  if (!node.enabled) score += 10

  return Math.min(100, score)
}

function buildActionPlan(nodes, maxActions) {
  const actions = []
  let index = 0

  for (const node of nodes) {
    if (!node.visible || !node.enabled) continue

    const riskScore = computeRiskScore(node)
    const intent = evaluateActionIntent(node)
    const actionId = `action-${index + 1}`

    let kind = 'click'
    if (node.tag === 'input' && (node.type === 'search' || node.type === 'text' || node.type === undefined)) {
      kind = 'type-search'
    } else if (node.tag === 'a' && node.href) {
      kind = 'click-link'
    }

    const signature = `${kind}|${node.selector}`
    actions.push({
      id: actionId,
      kind,
      intent,
      riskScore,
      node,
      signature,
      phase: riskScore <= 34 ? 1 : 2,
    })

    index += 1
    if (actions.length >= maxActions * 2) break
  }

  return actions
}

function shouldIncludeRequest(request, scope, tabUrl, includeHostRegexes, excludeHostRegexes) {
  const parsedTab = parseUrlSafe(tabUrl)
  const requestHost = hostFromUrl(request.url)
  if (!requestHost) return false

  for (const regex of excludeHostRegexes) {
    if (regex.test(requestHost)) return false
  }

  if (includeHostRegexes.length > 0 && includeHostRegexes.some((regex) => regex.test(requestHost))) {
    return true
  }

  if (!parsedTab) return true
  const tabHost = parsedTab.hostname

  if (scope === 'all') return true
  if (scope === 'origin') return requestHost === tabHost

  const requestDomain = getRegistrableDomain(requestHost)
  const tabDomain = getRegistrableDomain(tabHost)
  return requestDomain && tabDomain && requestDomain === tabDomain
}

function ensurePathObject(target, key) {
  if (!target[key]) target[key] = {}
  return target[key]
}

function buildOpenApi(clusters, serverUrl) {
  const paths = {}
  for (const cluster of clusters) {
    const pathEntry = ensurePathObject(paths, cluster.normalizedPath)
    const method = cluster.method.toLowerCase()
    const parameters = []

    const paramMatches = cluster.normalizedPath.match(/\{[^}]+\}/g) || []
    for (const token of paramMatches) {
      const name = token.slice(1, -1)
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })
    }

    pathEntry[method] = {
      summary: `${cluster.method} ${cluster.normalizedPath}`,
      operationId: `${method}_${cluster.normalizedPath.replace(/[{}\/]/g, '_')}`,
      parameters,
      requestBody: cluster.hasRequestBody
        ? {
          required: false,
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
            },
          },
        }
        : undefined,
      responses: {
        '200': {
          description: 'Observed success response',
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
            },
          },
        },
        default: {
          description: 'Observed response',
        },
      },
      'x-oko-observedCount': cluster.count,
      'x-oko-confidence': cluster.confidence,
      'x-oko-graphqlOperation': cluster.graphqlOperation || undefined,
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Oko Inferred API',
      version: '0.1.0',
      description: 'Draft OpenAPI inferred from autonomous browser discovery.',
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    paths,
  }
}

function buildPostmanCollection(templates, baseUrl) {
  return {
    info: {
      name: 'Oko Discovery Replay',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      {
        key: 'baseUrl',
        value: baseUrl || 'https://example.com',
      },
    ],
    item: templates.map((template) => ({
      name: `${template.method} ${template.normalizedPath}`,
      request: {
        method: template.method,
        header: Object.entries(template.headers || {}).map(([key, value]) => ({ key, value })),
        url: {
          raw: `{{baseUrl}}${template.pathTemplate}`,
          host: ['{{baseUrl}}'],
          path: template.pathTemplate.replace(/^\//, '').split('/'),
        },
        body: template.bodyTemplate
          ? {
            mode: 'raw',
            raw: template.bodyTemplate,
            options: { raw: { language: 'json' } },
          }
          : undefined,
      },
    })),
  }
}

function buildCurlCommand(template) {
  const lines = [`curl -X ${template.method} "${template.urlTemplate}"`]
  for (const [key, value] of Object.entries(template.headers || {})) {
    lines.push(`  -H '${key}: ${value}'`)
  }
  if (template.bodyTemplate) {
    lines.push(`  --data '${template.bodyTemplate.replace(/'/g, "'\\''")}'`)
  }
  return lines.join(' \\\n')
}

function buildPythonRequest(template) {
  return [
    'import requests',
    '',
    `url = "${template.urlTemplate}"`,
    `headers = ${JSON.stringify(template.headers || {}, null, 2)}`,
    template.bodyTemplate ? `payload = ${template.bodyTemplate}` : 'payload = None',
    '',
    `response = requests.request("${template.method}", url, headers=headers, json=payload if isinstance(payload, dict) else None, data=None if isinstance(payload, dict) else payload)`,
    'print(response.status_code)',
    'print(response.text)',
    '',
  ].join('\n')
}

function fileSafe(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
}

function looksLikeAuthRequest(request) {
  const headers = request.requestHeaders || {}
  const headerKeys = Object.keys(headers).map((key) => key.toLowerCase())
  if (headerKeys.includes('authorization') || headerKeys.includes('cookie') || headerKeys.includes('x-auth-token')) return true
  return /auth|login|session|token|refresh/i.test(request.url)
}

function inferDependencies(requests) {
  const authRequests = requests.filter(looksLikeAuthRequest)
  const tokenEndpoints = requests
    .filter((request) => /token|login|refresh|session|auth/i.test(request.url))
    .map((request) => ({ method: request.method, url: request.url, status: request.status || request.statusCode }))

  const refreshChains = []
  for (let i = 1; i < requests.length; i += 1) {
    const prev = requests[i - 1]
    const curr = requests[i]
    if (/refresh|token|session/i.test(prev.url) && looksLikeAuthRequest(curr)) {
      refreshChains.push({
        from: prev.url,
        to: curr.url,
      })
    }
  }

  return {
    authSignals: {
      authRequestCount: authRequests.length,
      tokenEndpointCount: tokenEndpoints.length,
      likelyAuthenticatedSession: authRequests.length > 0,
    },
    tokenEndpoints,
    refreshChains,
  }
}

async function writeArtifacts({
  outputDir,
  summary,
  filteredRequests,
  clusters,
  dependencies,
  templates,
  postmanCollection,
  openApiSpec,
  openApiReport,
}) {
  const replayDir = path.join(outputDir, 'replay')
  const curlDir = path.join(replayDir, 'curl')
  const pythonDir = path.join(replayDir, 'python')

  await fs.mkdir(curlDir, { recursive: true })
  await fs.mkdir(pythonDir, { recursive: true })

  await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8')
  await fs.writeFile(path.join(outputDir, 'requests.ndjson'), filteredRequests.map((request) => JSON.stringify(request)).join('\n') + '\n', 'utf8')
  await fs.writeFile(path.join(outputDir, 'endpoint-clusters.json'), JSON.stringify(clusters, null, 2) + '\n', 'utf8')
  await fs.writeFile(path.join(outputDir, 'dependencies.json'), JSON.stringify(dependencies, null, 2) + '\n', 'utf8')
  await fs.writeFile(path.join(replayDir, 'templates.json'), JSON.stringify(templates, null, 2) + '\n', 'utf8')
  await fs.writeFile(path.join(replayDir, 'postman-collection.json'), JSON.stringify(postmanCollection, null, 2) + '\n', 'utf8')

  for (const template of templates) {
    const baseName = fileSafe(`${template.method}_${template.normalizedPath}`)
    await fs.writeFile(path.join(curlDir, `${baseName}.sh`), `${buildCurlCommand(template)}\n`, 'utf8')
    await fs.writeFile(path.join(pythonDir, `${baseName}.py`), buildPythonRequest(template), 'utf8')
  }

  await fs.writeFile(path.join(outputDir, 'openapi.yaml'), `${stringifyYaml(openApiSpec)}`, 'utf8')
  await fs.writeFile(path.join(outputDir, 'openapi-report.json'), JSON.stringify(openApiReport, null, 2) + '\n', 'utf8')
}

async function safeMark(client, tabId, markerType, label, meta) {
  try {
    return await client.post('/api/browser/debugger/mark', {
      tabId,
      markerType,
      label,
      meta,
    }, { retry504: 0 })
  } catch {
    return null
  }
}

async function executeAction(client, tabId, action) {
  if (action.kind === 'type-search') {
    await client.post('/api/browser/type', {
      tabId,
      selector: action.node.selector,
      text: 'test',
      clear: true,
      delayMs: 25,
    }, { retry504: 0 })

    await client.post('/api/browser/key', {
      tabId,
      key: 'Enter',
      modifiers: [],
    }, { retry504: 0 })

    return { kind: action.kind, selector: action.node.selector }
  }

  await client.post('/api/browser/hover', {
    tabId,
    selector: action.node.selector,
  }, { retry504: 0 })

  await client.post('/api/browser/click', {
    tabId,
    selector: action.node.selector,
    mode: 'human',
  }, { retry504: 0 })

  return { kind: action.kind, selector: action.node.selector }
}

function buildTemplateFromRequest(request, cluster) {
  let pathTemplate = cluster.normalizedPath
  let origin = ''

  try {
    const parsed = new URL(request.url)
    origin = parsed.origin
    const params = []
    for (const [key, value] of parsed.searchParams.entries()) {
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(redactDynamicValue(value))}`)
    }
    if (params.length > 0) {
      pathTemplate = `${pathTemplate}?${params.join('&')}`
    }
  } catch {
    // Keep defaults.
  }

  const headers = {}
  for (const [key, value] of Object.entries(request.requestHeaders || {})) {
    const lower = key.toLowerCase()
    if (['cookie', 'authorization', 'x-auth-token', 'set-cookie'].includes(lower)) {
      headers[key] = `{{${lower.replace(/[^a-z0-9]+/g, '_')}}}`
    } else {
      headers[key] = redactDynamicValue(value)
    }
  }

  const bodyTemplate = request.requestBody ? redactDynamicValue(request.requestBody) : undefined

  return {
    clusterId: cluster.id,
    method: cluster.method,
    normalizedPath: cluster.normalizedPath,
    urlTemplate: `${origin}${pathTemplate}`,
    pathTemplate,
    headers,
    bodyTemplate,
    graphqlOperation: cluster.graphqlOperation || undefined,
  }
}

function clusterRequests(requests) {
  const clusterMap = new Map()
  let seq = 1

  for (const request of requests) {
    const parsed = parseUrlSafe(request.url)
    const normalizedPath = parsed ? normalizePathname(parsed.pathname) : request.url
    const contentType = pickContentType(request) || 'unknown'
    const graphqlOperation = detectGraphqlOperation(request)
    const key = [
      (request.method || 'GET').toUpperCase(),
      normalizedPath,
      contentType,
      graphqlOperation || '-',
    ].join(' | ')

    if (!clusterMap.has(key)) {
      clusterMap.set(key, {
        id: `cluster-${seq}`,
        key,
        method: (request.method || 'GET').toUpperCase(),
        normalizedPath,
        contentType,
        graphqlOperation,
        host: hostFromUrl(request.url),
        count: 0,
        statuses: new Set(),
        sampleRequest: null,
      })
      seq += 1
    }

    const cluster = clusterMap.get(key)
    cluster.count += 1
    const status = request.status || request.statusCode
    if (status) cluster.statuses.add(status)
    if (!cluster.sampleRequest) cluster.sampleRequest = request
  }

  const clusters = Array.from(clusterMap.values()).map((cluster) => ({
    id: cluster.id,
    key: cluster.key,
    method: cluster.method,
    normalizedPath: cluster.normalizedPath,
    contentType: cluster.contentType,
    graphqlOperation: cluster.graphqlOperation,
    host: cluster.host,
    count: cluster.count,
    statuses: Array.from(cluster.statuses).sort((a, b) => a - b),
    confidence: Math.min(1, 0.35 + Math.log10(cluster.count + 1) * 0.35),
    hasRequestBody: Boolean(cluster.sampleRequest?.requestBody),
    hasResponseBody: Boolean(cluster.sampleRequest?.responseBody),
    sample: {
      url: cluster.sampleRequest?.url,
      requestFingerprint: cluster.sampleRequest?.requestFingerprint,
    },
  }))

  clusters.sort((a, b) => b.count - a.count)
  return clusters
}

export async function runDiscoverApi({ client, options, config }) {
  const runId = crypto.randomUUID()
  const startedAt = Date.now()

  const outputDir = options.outputDir || path.resolve('.oko', 'discovery', nowStamp())
  await fs.mkdir(outputDir, { recursive: true })

  const includeHostRegexes = compileRegexList(options.includeHost || [])
  const excludeHostRegexes = compileRegexList(options.excludeHost || [])

  let tabId
  let targetTab = null
  const skippedActions = []
  const executedActions = []
  const errors = []
  const phaseMetrics = []
  let debuggerEnabled = false

  const budgetMs = Math.max(60 * 1000, Math.round(options.budgetMin * 60 * 1000))
  const deadline = startedAt + budgetMs

  const withinBudget = () => Date.now() < deadline

  try {
    tabId = await resolveCaptureTabId(client, {
      tabId: options.tabId,
      tabUrl: options.tabUrl,
      active: options.active,
    })

    const tabsResult = await client.get('/api/browser/tabs', { retry504: 0 })
    const tabs = Array.isArray(tabsResult?.tabs) ? tabsResult.tabs : []
    targetTab = tabs.find((tab) => tab.id === tabId) || null
    const tabUrl = targetTab?.url || ''

    if (!tabUrl || /^chrome:\/\//.test(tabUrl) || /^chrome-extension:\/\//.test(tabUrl)) {
      throw new UsageError('Target tab URL is not automatable. Open a normal web app tab and retry.')
    }

    if (options.seedPath) {
      const parsed = parseUrlSafe(tabUrl)
      if (parsed) {
        const seededUrl = new URL(options.seedPath, `${parsed.origin}/`).toString()
        await client.post('/api/browser/navigate', { tabId, url: seededUrl }, { retry504: 0 })
      }
    }

    await client.post('/api/browser/debugger/enable', {
      tabId,
      mode: 'full',
      maxRequests: Math.max(1000, options.maxActions * 20),
      captureBody: true,
    })
    debuggerEnabled = true

    await safeMark(client, tabId, 'phase', 'phase-1-non-mutating', {
      runId,
      budgetMs,
      scope: options.scope,
    })

    const baselineStart = Date.now()
    const baselineMs = options.baselineMs !== undefined
      ? Math.max(0, options.baselineMs)
      : Math.min(20000, Math.max(1000, Math.floor((deadline - Date.now()) * 0.2)))
    await sleep(Math.max(0, baselineMs))
    phaseMetrics.push({ phase: 'baseline', elapsedMs: Date.now() - baselineStart })

    const interactablesStart = Date.now()
    const interactablesResponse = await client.post('/api/browser/interactables', {
      tabId,
      maxNodes: Math.max(100, Math.min(options.maxActions * 10, 2000)),
      includeHidden: false,
    }, { retry504: 0 })
    const interactables = Array.isArray(interactablesResponse?.items) ? interactablesResponse.items : []
    phaseMetrics.push({ phase: 'interactables', elapsedMs: Date.now() - interactablesStart, count: interactables.length })

    const actions = buildActionPlan(interactables, options.maxActions)
    const visitedSignatures = new Set()

    const runActionQueue = async (phaseNumber) => {
      for (const action of actions) {
        if (!withinBudget()) break
        if (executedActions.length >= options.maxActions) break
        if (action.phase !== phaseNumber) continue
        if (visitedSignatures.has(action.signature)) continue

        visitedSignatures.add(action.signature)

        if (action.riskScore >= 65) {
          skippedActions.push({
            actionId: action.id,
            selector: action.node.selector,
            reason: 'risk-score>=65',
            riskScore: action.riskScore,
          })
          continue
        }

        const isSafeIntent = SAFE_MUTATION_INTENTS.has(action.intent)
        if (phaseNumber === 2 && (!options.allowPhase2 || !isSafeIntent)) {
          skippedActions.push({
            actionId: action.id,
            selector: action.node.selector,
            reason: options.allowPhase2 ? `intent-not-allowlisted:${action.intent}` : 'phase2-disabled',
            riskScore: action.riskScore,
          })
          continue
        }

        const highRiskKeyword = HIGH_RISK_KEYWORDS.find((keyword) => {
          const text = `${action.node.text || ''} ${action.node.ariaLabel || ''} ${action.node.href || ''}`.toLowerCase()
          return text.includes(keyword)
        })
        if (highRiskKeyword) {
          skippedActions.push({
            actionId: action.id,
            selector: action.node.selector,
            reason: `blocked-keyword:${highRiskKeyword}`,
            riskScore: action.riskScore,
          })
          continue
        }

        const stepStart = Date.now()
        await safeMark(client, tabId, 'action-start', action.id, {
          selector: action.node.selector,
          kind: action.kind,
          riskScore: action.riskScore,
          intent: action.intent,
          phase: phaseNumber,
        })

        try {
          const result = await executeAction(client, tabId, action)
          executedActions.push({
            actionId: action.id,
            selector: action.node.selector,
            kind: action.kind,
            phase: phaseNumber,
            elapsedMs: Date.now() - stepStart,
            result,
          })
        } catch (err) {
          errors.push({
            actionId: action.id,
            selector: action.node.selector,
            phase: phaseNumber,
            error: err instanceof Error ? err.message : String(err),
          })
        } finally {
          await safeMark(client, tabId, 'action-end', action.id, {
            phase: phaseNumber,
          })
        }

        await sleep(350)
      }
    }

    const phase1Start = Date.now()
    await runActionQueue(1)
    phaseMetrics.push({ phase: 'phase-1', elapsedMs: Date.now() - phase1Start, executed: executedActions.filter((a) => a.phase === 1).length })

    if (options.allowPhase2 && withinBudget()) {
      await safeMark(client, tabId, 'phase', 'phase-2-controlled-mutation', { runId })
      const phase2Start = Date.now()
      await runActionQueue(2)
      phaseMetrics.push({ phase: 'phase-2', elapsedMs: Date.now() - phase2Start, executed: executedActions.filter((a) => a.phase === 2).length })
    }

    const requestsResult = await client.get('/api/browser/debugger/requests', {
      query: {
        tabId,
        limit: 5000,
        offset: 0,
        includeMarkers: true,
        includeInitiator: true,
        includeFrame: true,
      },
      retry504: 0,
    })

    const allRequests = Array.isArray(requestsResult?.requests) ? requestsResult.requests : []
    const filteredRequests = allRequests
      .filter((request) => shouldIncludeRequest(request, options.scope, tabUrl, includeHostRegexes, excludeHostRegexes))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

    const clusters = clusterRequests(filteredRequests)
    const dependencies = inferDependencies(filteredRequests)
    const templates = clusters
      .map((cluster) => {
        const sampleRequest = filteredRequests.find((request) => {
          const parsed = parseUrlSafe(request.url)
          const normalized = parsed ? normalizePathname(parsed.pathname) : request.url
          const method = (request.method || 'GET').toUpperCase()
          return method === cluster.method && normalized === cluster.normalizedPath
        })
        if (!sampleRequest) return null
        return buildTemplateFromRequest(sampleRequest, cluster)
      })
      .filter(Boolean)

    const parsedTabUrl = parseUrlSafe(tabUrl)
    const openApiSpec = buildOpenApi(clusters, parsedTabUrl?.origin)
    const openApiReport = {
      generatedAt: new Date().toISOString(),
      totalClusters: clusters.length,
      averageConfidence: clusters.length > 0
        ? Number((clusters.reduce((sum, cluster) => sum + cluster.confidence, 0) / clusters.length).toFixed(3))
        : 0,
      unresolved: {
        missingSampleBodies: clusters.filter((cluster) => !cluster.hasRequestBody && !cluster.hasResponseBody).map((cluster) => cluster.key),
      },
      clusterConfidence: clusters.map((cluster) => ({
        id: cluster.id,
        key: cluster.key,
        confidence: cluster.confidence,
        count: cluster.count,
      })),
    }

    const postmanCollection = buildPostmanCollection(templates, parsedTabUrl?.origin)

    const summary = {
      success: true,
      runId,
      tabId,
      tabUrl,
      elapsedMs: Date.now() - startedAt,
      phases: phaseMetrics,
      stats: {
        interactablesDiscovered: interactables.length,
        actionsPlanned: actions.length,
        actionsExecuted: executedActions.length,
        actionsSkipped: skippedActions.length,
        errors: errors.length,
        requestsCaptured: allRequests.length,
        requestsInScope: filteredRequests.length,
        endpointClusters: clusters.length,
        sessionAuthConfidence: dependencies.authSignals.likelyAuthenticatedSession ? 'high' : 'low',
      },
      artifacts: {
        outputDir,
        summary: path.join(outputDir, 'summary.json'),
        requests: path.join(outputDir, 'requests.ndjson'),
        endpointClusters: path.join(outputDir, 'endpoint-clusters.json'),
        dependencies: path.join(outputDir, 'dependencies.json'),
        templates: path.join(outputDir, 'replay', 'templates.json'),
        postmanCollection: path.join(outputDir, 'replay', 'postman-collection.json'),
        curlDir: path.join(outputDir, 'replay', 'curl'),
        pythonDir: path.join(outputDir, 'replay', 'python'),
        openapi: path.join(outputDir, 'openapi.yaml'),
        openapiReport: path.join(outputDir, 'openapi-report.json'),
      },
      skippedActions,
      errors,
    }

    await writeArtifacts({
      outputDir,
      summary,
      filteredRequests,
      clusters,
      dependencies,
      templates,
      postmanCollection,
      openApiSpec,
      openApiReport,
    })

    return summary
  } finally {
    if (debuggerEnabled && tabId !== undefined) {
      try {
        await client.post('/api/browser/debugger/disable', { tabId }, { retry504: 0 })
      } catch {
        // Best effort cleanup.
      }
    }
  }
}

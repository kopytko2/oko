export async function runScreenshot({ client, options }) {
  const response = await client.get('/api/browser/screenshot', {
    query: {
      tabId: options.tabId,
      fullPage: options.fullPage,
    },
  })

  return {
    success: true,
    tabId: options.tabId,
    fullPage: options.fullPage,
    screenshot: response?.screenshot,
  }
}

export async function runClick({ client, options }) {
  const response = await client.post('/api/browser/click', {
    tabId: options.tabId,
    selector: options.selector,
    mode: options.mode,
  })

  return {
    success: response?.success !== false,
    tabId: options.tabId,
    selector: options.selector,
    mode: options.mode,
    raw: response,
  }
}

export async function runFill({ client, options }) {
  const response = await client.post('/api/browser/fill', {
    tabId: options.tabId,
    selector: options.selector,
    value: options.value,
  })

  return {
    success: response?.success !== false,
    tabId: options.tabId,
    selector: options.selector,
    raw: response,
  }
}

export async function runHover({ client, options }) {
  const response = await client.post('/api/browser/hover', {
    tabId: options.tabId,
    selector: options.selector,
  })

  return {
    success: response?.success !== false,
    tabId: options.tabId,
    selector: options.selector,
    raw: response,
  }
}

export async function runType({ client, options }) {
  const response = await client.post('/api/browser/type', {
    tabId: options.tabId,
    selector: options.selector,
    text: options.text,
    clear: options.clear,
    delayMs: options.delayMs,
  })

  return {
    success: response?.success !== false,
    tabId: options.tabId,
    selector: options.selector,
    textLength: options.text.length,
    clear: options.clear,
    delayMs: options.delayMs,
    raw: response,
  }
}

export async function runKey({ client, options }) {
  const response = await client.post('/api/browser/key', {
    tabId: options.tabId,
    key: options.key,
    modifiers: options.modifiers,
  })

  return {
    success: response?.success !== false,
    tabId: options.tabId,
    key: options.key,
    modifiers: options.modifiers,
    raw: response,
  }
}

export async function runScroll({ client, options }) {
  const response = await client.post('/api/browser/scroll', {
    tabId: options.tabId,
    selector: options.selector,
    deltaX: options.deltaX,
    deltaY: options.deltaY,
    to: options.to,
    behavior: options.behavior,
  })

  return {
    success: response?.success !== false,
    tabId: options.tabId,
    selector: options.selector,
    deltaX: options.deltaX,
    deltaY: options.deltaY,
    to: options.to,
    behavior: options.behavior,
    raw: response,
  }
}

export async function runWait({ client, options }) {
  const response = await client.post('/api/browser/wait', {
    tabId: options.tabId,
    condition: options.condition,
    selector: options.selector,
    state: options.state,
    urlIncludes: options.urlIncludes,
    timeoutMs: options.timeoutMs,
    pollMs: options.pollMs,
  })

  return {
    success: response?.success !== false && response?.matched === true,
    matched: response?.matched === true,
    elapsedMs: response?.elapsedMs,
    tabId: options.tabId,
    condition: options.condition,
    raw: response,
  }
}

export async function runAssert({ client, options }) {
  const response = await client.post('/api/browser/assert', {
    tabId: options.tabId,
    selector: options.selector,
    visible: options.visible,
    enabled: options.enabled,
    textContains: options.textContains,
    valueEquals: options.valueEquals,
    urlIncludes: options.urlIncludes,
  })

  return {
    success: response?.success !== false && response?.passed === true,
    passed: response?.passed === true,
    details: response?.details || {},
    tabId: options.tabId,
    raw: response,
  }
}

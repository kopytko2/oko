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
  })

  return {
    success: response?.success !== false,
    tabId: options.tabId,
    selector: options.selector,
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

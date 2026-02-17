function normalizeApiPath(path) {
  if (!path.startsWith('/')) return `/${path}`
  return path
}

export async function runApiCall({ client, method, options }) {
  const path = normalizeApiPath(options.path)

  if (method === 'get') {
    return client.get(path, { query: options.query, retry504: 0 })
  }

  if (method === 'post') {
    return client.post(path, options.json ?? {}, { retry504: 0 })
  }

  if (method === 'delete') {
    return client.del(path, { query: options.query, retry504: 0 })
  }

  throw new Error(`Unsupported API method: ${method}`)
}

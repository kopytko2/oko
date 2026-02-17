export async function runTabsList({ client }) {
  const response = await client.get('/api/browser/tabs')
  const tabs = Array.isArray(response?.tabs) ? response.tabs : []

  return {
    success: true,
    total: tabs.length,
    tabs,
  }
}

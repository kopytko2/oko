# Oko: Ona Environment Integration

Connect Oko to remote Ona environments instead of localhost.

## Problem

Oko hardcodes `localhost:8129` in ~30 files. The backend must run on the same machine as the browser. This prevents using Oko with remote Ona development environments.

## Current Architecture

```
┌─────────────────────┐     WebSocket      ┌─────────────────────┐
│  Chrome Extension   │ ←───────────────→  │  Backend (Node.js)  │
│  (Browser sidebar)  │   localhost:8129   │  + PTY + tmux       │
└─────────────────────┘                    └─────────────────────┘
         ↑                                           ↑
         │                                           │
    Same machine                               Same machine
```

## Proposed Architecture

```
┌─────────────────────┐                    ┌─────────────────────────────────┐
│  Chrome Extension   │     HTTPS/WSS     │  Ona Environment                │
│  (User's browser)   │ ←───────────────→ │  ┌─────────────────────────┐    │
│                     │   Public URL      │  │  Backend (Node.js)      │    │
│  Settings:          │                   │  │  Port 8129 (exposed)    │    │
│  - Environment URL  │                   │  │  + PTY + tmux           │    │
│  - Auth token       │                   │  └─────────────────────────┘    │
└─────────────────────┘                   └─────────────────────────────────┘
```

## Connection Options

### Option A: Ona Port Forwarding (Recommended)

Expose port 8129 from the Ona environment:

```bash
# In Ona environment
gitpod environment port open 8129 --name "oko-backend"

# Returns public URL:
# https://8129--019b514e-b72e-77f8-8f8a-52455a02a0ba.us-east-1-01.gitpod.dev
```

Extension connects to this public URL. Requires WSS support and enhanced auth.

### Option B: SSH Tunnel

Forward port locally via SSH:

```bash
# On user's local machine
gitpod environment ssh <env-id> -L 8129:localhost:8129
```

Extension still uses `localhost:8129`, tunneled to Ona. No extension changes needed, but requires persistent SSH connection.

---

## Scope (Browser-only + DevTools Data)

Primary goal: let Ona agents drive and inspect the live browser session (tabs, screenshots, DOM, network) without requiring terminal/tmux features. Terminal endpoints can remain untouched or be disabled later, but they are not required for browser-only use.

**Browser-only minimum changes**:
- Remote backend URL + WSS support in the extension background connection layer
- Settings UI to configure backend URL and auth token
- `manifest.json` host permissions to allow the Ona/Gitpod domain(s)
- Backend auth + CORS hardening + health endpoint

**DevTools-like data** (Network, Elements, Sources, Performance) requires a CDP bridge via `chrome.debugger` and new API endpoints. See Phase 7+.

## Implementation Plan

### Phase 1: URL Abstraction

**Goal**: Centralize all backend URLs into a single configurable module.

**Create `extension/lib/api.ts`**:

```typescript
import { getConnectionSettings } from './connection'

let cachedSettings: { apiUrl: string; wsUrl: string } | null = null

export async function getApiUrl(): Promise<string> {
  if (!cachedSettings) {
    cachedSettings = await getConnectionSettings()
  }
  return cachedSettings.apiUrl
}

export async function getWsUrl(): Promise<string> {
  if (!cachedSettings) {
    cachedSettings = await getConnectionSettings()
  }
  return cachedSettings.wsUrl
}

export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`
}

export function clearCache(): void {
  cachedSettings = null
}
```

**Create `extension/lib/connection.ts`**:

```typescript
export interface ConnectionSettings {
  backendUrl: string
  authToken: string
}

const DEFAULT_BACKEND_URL = 'http://localhost:8129'

export async function getConnectionSettings(): Promise<{ apiUrl: string; wsUrl: string; authToken: string }> {
  const settings = await chrome.storage.sync.get(['backendUrl', 'authToken'])
  const backendUrl = settings.backendUrl || DEFAULT_BACKEND_URL
  
  const url = new URL(backendUrl)
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${url.host}`
  
  return {
    apiUrl: backendUrl,
    wsUrl,
    authToken: settings.authToken || ''
  }
}

export async function saveConnectionSettings(settings: ConnectionSettings): Promise<void> {
  await chrome.storage.sync.set({
    backendUrl: settings.backendUrl,
    authToken: settings.authToken
  })
}

export async function testConnection(backendUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${backendUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })
    if (response.ok) {
      return { success: true }
    }
    return { success: false, error: `HTTP ${response.status}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection failed' }
  }
}
```

**Effort**: 2-3 hours

### Phase 2: Replace Hardcoded URLs

**Files requiring changes**:

| File | Occurrences |
|------|-------------|
| `extension/background/state.ts` | 1 |
| `extension/background/websocket.ts` | 2 |
| `extension/hooks/useClaudeStatus.ts` | 1 |
| `extension/hooks/useAudioNotifications.ts` | 1 |
| `extension/hooks/useOrphanedSessions.ts` | 1 |
| `extension/hooks/useWorkingDirectory.ts` | 1 |
| `extension/sidepanel/sidepanel.tsx` | 4 |
| `extension/components/SettingsModal.tsx` | 3 |
| `extension/components/settings/ProfilesTab.tsx` | 1 |
| `extension/components/settings/AudioTab.tsx` | 1 |
| `extension/components/settings/McpToolsTab.tsx` | 1 |
| `extension/components/ErrorBoundary.tsx` | 1 |
| `extension/dashboard/sections/McpPlayground.tsx` | 1 |
| `extension/dashboard/sections/Settings.tsx` | 3 |
| `extension/dashboard/sections/Home.tsx` | 2 |
| `extension/dashboard/sections/ApiPlayground.tsx` | 1 |
| `extension/dashboard/sections/Files.tsx` | 2 |
| `extension/dashboard/sections/Terminals.tsx` | 1 |
| `extension/dashboard/contexts/FilesContext.tsx` | 1 |
| `extension/dashboard/hooks/useDashboard.ts` | 1 |
| `extension/dashboard/components/files/PromptyViewer.tsx` | 1 |
| `extension/dashboard/components/files/FileTree.tsx` | 1 |

**Browser-only subset** (if you want to skip terminal/dashboard work): update only
`extension/background/websocket.ts`, `extension/background/state.ts`,
`extension/shared/consoleForwarder.ts`, `extension/components/SettingsModal.tsx`,
`extension/dashboard/sections/Settings.tsx`, and `extension/manifest.json`.

**Pattern**:

```typescript
// Before
const response = await fetch('http://localhost:8129/api/spawn', { ... })

// After
import { getApiUrl, apiUrl } from '../lib/api'

const baseUrl = await getApiUrl()
const response = await fetch(apiUrl(baseUrl, '/api/spawn'), { ... })
```

**Effort**: 2-3 hours

### Phase 3: Settings UI

**Add Connection tab to `extension/components/SettingsModal.tsx`**:

```typescript
// New tab type
type TabType = 'profiles' | 'mcp' | 'audio' | 'connection'

// Connection tab component
function ConnectionTab({ 
  settings, 
  onSave 
}: { 
  settings: ConnectionSettings
  onSave: (settings: ConnectionSettings) => void 
}) {
  const [backendUrl, setBackendUrl] = useState(settings.backendUrl)
  const [authToken, setAuthToken] = useState(settings.authToken)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')

  const handleTest = async () => {
    setTestStatus('testing')
    const result = await testConnection(backendUrl)
    if (result.success) {
      setTestStatus('success')
    } else {
      setTestStatus('error')
      setTestError(result.error || 'Unknown error')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Backend URL</label>
        <input
          type="text"
          value={backendUrl}
          onChange={(e) => setBackendUrl(e.target.value)}
          placeholder="http://localhost:8129 or https://8129--xxx.gitpod.dev"
          className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-700"
        />
        <p className="text-xs text-gray-500 mt-1">
          For Ona environments, use the public URL from `gitpod environment port open 8129`
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Auth Token</label>
        <input
          type="password"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder="Optional for localhost"
          className="w-full px-3 py-2 bg-gray-800 rounded border border-gray-700"
        />
        <p className="text-xs text-gray-500 mt-1">
          Set OKO_AUTH_TOKEN in your Ona environment
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button onClick={handleTest} className="px-4 py-2 bg-blue-600 rounded">
          Test Connection
        </button>
        {testStatus === 'testing' && <span>Testing...</span>}
        {testStatus === 'success' && <span className="text-green-500">✓ Connected</span>}
        {testStatus === 'error' && <span className="text-red-500">✗ {testError}</span>}
      </div>

      <button 
        onClick={() => onSave({ backendUrl, authToken })}
        className="px-4 py-2 bg-green-600 rounded"
      >
        Save
      </button>
    </div>
  )
}
```

**Effort**: 2 hours

### Phase 4: Backend Auth Enhancement

**Modify `backend/server.js`**:

```javascript
// Support configurable auth token via environment variable
const WS_AUTH_TOKEN = process.env.OKO_AUTH_TOKEN || crypto.randomBytes(32).toString('hex')

// Log token location for local dev, but not the token itself for remote
if (!process.env.OKO_AUTH_TOKEN) {
  fs.writeFileSync(WS_AUTH_TOKEN_FILE, WS_AUTH_TOKEN)
  console.log(`Auth token written to ${WS_AUTH_TOKEN_FILE}`)
} else {
  console.log('Using OKO_AUTH_TOKEN from environment')
}

// Enhanced CORS for Ona URLs
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, etc.)
    if (!origin) return callback(null, true)
    
    // Allow Chrome extensions
    if (origin.startsWith('chrome-extension://')) return callback(null, true)
    
    // Allow Gitpod/Ona URLs
    if (origin.match(/\.gitpod\.dev$/)) return callback(null, true)
    
    // Allow localhost
    if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)/)) return callback(null, true)
    
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true
}))

// Add health endpoint for connection testing
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})
```

**Add token validation to WebSocket**:

```javascript
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const token = url.searchParams.get('token') || req.headers['x-auth-token']
  
  if (token !== WS_AUTH_TOKEN) {
    ws.close(4001, 'Unauthorized')
    return
  }
  
  // ... rest of connection handling
})
```

**Effort**: 1 hour

### Phase 5: WSS Support

**Modify `extension/background/websocket.ts`**:

```typescript
export async function connectWebSocket(): Promise<void> {
  const settings = await getConnectionSettings()
  
  // Fetch auth token
  let wsUrl = settings.wsUrl
  try {
    const tokenResponse = await fetch(`${settings.apiUrl}/api/auth/token`, {
      headers: settings.authToken ? { 'X-Auth-Token': settings.authToken } : {}
    })
    if (tokenResponse.ok) {
      const { token } = await tokenResponse.json()
      if (token) {
        wsUrl = `${settings.wsUrl}?token=${token}`
      }
    }
  } catch {
    // Use configured auth token as fallback
    if (settings.authToken) {
      wsUrl = `${settings.wsUrl}?token=${settings.authToken}`
    }
  }

  console.log('Connecting to backend WebSocket:', wsUrl.replace(/token=.*/, 'token=***'))
  const newWs = new WebSocket(wsUrl)
  // ... rest unchanged
}
```

**Effort**: 30 minutes

### Phase 6: Testing

**Test scenarios**:

1. **Localhost (existing behavior)** - Verify no regression
2. **Ona with port forwarding** - Full remote connection
3. **SSH tunnel** - Local port forwarded to Ona
4. **Invalid URL** - Graceful error handling
5. **Auth token mismatch** - Proper rejection

**Effort**: 2 hours

### Phase 7: DevTools Bridge (CDP Session Manager)

**Goal**: Provide DevTools-like data (Network/Elements/Sources/Performance) to the backend via a persistent Chrome Debugger (CDP) session.

**Extension changes**:
- Add `extension/background/devtoolsCapture.ts` to manage per-tab CDP sessions.
- Refactor existing debugger helpers (`extension/background/browserMcp/debugger.ts`) to reuse the shared session instead of attach/detach per call. This avoids conflicts and supports streaming events.
- Enable CDP domains: `Network`, `Runtime`, `Log`, `DOM`, `CSS`, `Debugger`, `Page` (optional `Tracing`).
- Listen to `chrome.debugger.onEvent` and persist bounded ring buffers per tab:
  - Network: `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`, `Network.loadingFailed`, `Network.webSocket*`
  - Console: `Runtime.consoleAPICalled`, `Log.entryAdded`
  - DOM changes (optional): `DOM.documentUpdated`, `DOM.childNodeInserted`, `DOM.childNodeRemoved`
  - Script catalog: `Debugger.scriptParsed`
- Add on-demand CDP commands (via WebSocket messages):
  - `Network.getResponseBody` (with size limit and opt-in)
  - `Debugger.getScriptSource`
  - `CSS.getMatchedStylesForNode`
  - `DOM.getBoxModel` / `DOM.getOuterHTML`
  - `Accessibility.getFullAXTree` (optional)

**Effort**: 4-6 hours

### Phase 8: DevTools API Surface (Backend Routes + WS Messages)

**Goal**: Expose DevTools data through browser MCP endpoints so Ona agents can query it.

**Backend changes**:
- Add new endpoints under `/api/browser/devtools/*`:
  - `POST /api/browser/devtools/enable` (tabId, domains, captureResponseBodies, urlAllowlist, maxBodyBytes)
  - `POST /api/browser/devtools/disable`
  - `GET /api/browser/devtools/network` (filters, pagination, tabId)
  - `GET /api/browser/devtools/network/:requestId/body` (on-demand body fetch)
  - `GET /api/browser/devtools/console` (if you want CDP logs vs existing console buffer)
  - `GET /api/browser/devtools/elements` (selector/nodeId -> styles + box model)
  - `GET /api/browser/devtools/dom-tree` (reuse existing DOM tree)
  - `GET /api/browser/devtools/sources` (script list)
  - `GET /api/browser/devtools/source` (script source by scriptId)
  - `POST /api/browser/devtools/trace/start` + `POST /api/browser/devtools/trace/stop` (optional timeline data)
- Reuse the pending request mechanism to send WS requests to the extension and return results.
- Enforce size limits and redactions (strip cookies/authorization headers by default).

**Effort**: 3-5 hours

### Phase 9: MCP Tools + Safety Controls

**Goal**: Make DevTools data available to the LLM via MCP tools and protect sensitive data.

**Tasks**:
- Add MCP tool definitions for:
  - `oko_devtools_network`, `oko_devtools_response_body`
  - `oko_devtools_elements`, `oko_devtools_dom_tree`
  - `oko_devtools_sources`, `oko_devtools_source`
  - `oko_devtools_trace` (optional)
- Add server-side filtering rules (cookies, auth headers, large bodies).
- Add opt-in flags for response body capture and script source access.

**Effort**: 2-3 hours

### Phase 10: DevTools QA

**Test scenarios**:
1. Network capture + response body for XHR/fetch
2. Elements inspection (styles + box model) on dynamic pages
3. Sources list + script source fetch
4. Performance metrics / trace (if enabled)
5. Debugger attach conflicts (ensure no detach during active capture)

**Effort**: 2 hours

---

## Summary

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | URL abstraction module | 2-3 hours |
| 2 | Replace hardcoded URLs | 2-3 hours |
| 3 | Settings UI | 2 hours |
| 4 | Backend auth enhancement | 1 hour |
| 5 | WSS support | 30 min |
| 6 | Testing | 2 hours |
| 7 | DevTools CDP bridge | 4-6 hours |
| 8 | DevTools API surface | 3-5 hours |
| 9 | MCP tools + safety | 2-3 hours |
| 10 | DevTools QA | 2 hours |
| **Total** | | **23-31 hours** |

---

## Quick Start (No Code Changes)

For immediate use without forking:

### SSH Tunnel Method

```bash
# Terminal 1: Start backend in Ona
gitpod environment ssh <env-id> -- "cd ~/project && git clone https://github.com/kopytko2/oko && cd Oko/backend && npm install && npm start"

# Terminal 2: SSH tunnel (keep running)
gitpod environment ssh <env-id> -L 8129:localhost:8129

# Extension connects to localhost:8129 as normal
```

### Port Forwarding (Manual Edit)

```bash
# In Ona environment
cd ~/Oko/backend
npm install && npm start &
gitpod environment port open 8129
# Note the URL: https://8129--xxx.gitpod.dev
```

Then manually edit `extension/background/state.ts`:

```typescript
export const WS_URL = 'wss://8129--xxx.gitpod.dev'
```

And rebuild: `npm run build`

---

## Ona Environment Setup

Add to your Ona environment's devcontainer or automations:

```yaml
# automations.yaml
services:
  oko-backend:
    name: Oko Backend
    command: |
      cd ~/Oko/backend
      npm install
      OKO_AUTH_TOKEN=${OKO_AUTH_TOKEN:-$(openssl rand -hex 32)} npm start
    triggeredBy:
      - postDevcontainerStart
```

```json
// devcontainer.json
{
  "containerEnv": {
    "OKO_AUTH_TOKEN": "${localEnv:OKO_AUTH_TOKEN}"
  },
  "forwardPorts": [8129]
}
```

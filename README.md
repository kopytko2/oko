# Oko

Oko is a Chrome extension + backend that lets you automate and inspect your browser from a development environment. Control tabs, capture network traffic, click elements, fill forms, and take screenshots via an agent-first CLI or the raw REST API.

## Features

- **Navigate** - Open URLs in new or existing tabs
- **Network capture** - Capture requests with headers, or full response bodies via debugger
- **Element picker** - Select elements visually with `Alt+Shift+O`
- **Screenshots** - Capture visible area or full page
- **DOM interaction** - Click, hover, type, press keys, scroll, wait/assert against DOM and URL

## Quick start

### 1. Start the backend

```bash
cd backend
npm install
npm start
```

In Ona/Gitpod environments, the backend outputs the connection config on startup:

```
============================================================
  Oko Extension Config (copy/paste into Quick Config):
============================================================
URL: https://8129--<env-id>.gitpod.dev
Token: <generated-token>
============================================================
```

### 2. Load the extension

1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select the `extension/` folder

### 3. Connect

**Quick connect (recommended):**
1. Copy the connection code from the backend output (starts with `oko:`)
2. Open the Oko extension popup
3. Paste the code into the "Connection Code" field - it auto-saves and connects

**Manual setup:**
Open the Oko extension popup, paste the URL and token separately, click **Test** then **Save**.

## CLI (Recommended for agents)

The CLI wraps auth headers, retries, and debugger lifecycle cleanup.

```bash
# Health + extension connectivity
npm run oko -- doctor

# List tabs
npm run oko -- tabs list

# Capture API traffic from active tab (10s default window)
npm run oko -- capture api --mode full --url-pattern api

# Stream real-time NDJSON while interacting (stop with Enter)
npm run oko -- capture api --follow --until-enter --output ndjson

# Capture until Enter and write to file
npm run oko -- capture api --until-enter --out capture.json

# Human-like deterministic browser actions
npm run oko -- browser hover --tab-id 123 --selector "button.submit"
npm run oko -- browser type --tab-id 123 --selector "input[name=email]" --text "test@example.com" --clear
npm run oko -- browser wait --tab-id 123 --condition element --selector "#ready" --state visible
npm run oko -- browser assert --tab-id 123 --selector "h1" --text-contains "Dashboard"

# Run declarative frontend scenario
npm run oko -- test run docs/examples/login-scenario.yaml --strict

# Low-level passthrough if needed
npm run oko -- api get /api/browser/tabs
```

Global options:
- `--url <url>` (default: `http://localhost:8129`)
- `--token <token>`
- `--connection-code <oko:...>`
- `--timeout-ms <n>`
- `--output json|ndjson|text`

Scenario schema and examples: `docs/testing-scenarios.md`, `docs/examples/login-scenario.yaml`.

## API Reference

All endpoints require `X-Auth-Token` header for remote connections.

### Tabs & Navigation

```bash
# List open tabs
GET /api/browser/tabs

# Navigate to URL
POST /api/browser/navigate
{"url": "https://example.com", "newTab": true}
# or navigate existing tab:
{"url": "https://example.com", "tabId": 12345}
```

### Element Interaction

```bash
# Get selected element (after user presses Alt+Shift+O)
GET /api/browser/selected-element

# Get element info by selector
POST /api/browser/element-info
{"tabId": 12345, "selector": "h1"}

# Click element
POST /api/browser/click
{"tabId": 12345, "selector": "button.submit"}

# Fill input
POST /api/browser/fill
{"tabId": 12345, "selector": "input[name=email]", "value": "test@example.com"}

# Hover element
POST /api/browser/hover
{"tabId": 12345, "selector": "button.submit"}

# Type with deterministic key cadence
POST /api/browser/type
{"tabId": 12345, "selector": "input[name=email]", "text": "test@example.com", "clear": true, "delayMs": 35}

# Press key
POST /api/browser/key
{"tabId": 12345, "key": "Enter", "modifiers": ["Shift"]}

# Scroll
POST /api/browser/scroll
{"tabId": 12345, "deltaY": 400, "behavior": "smooth"}

# Wait for condition
POST /api/browser/wait
{"tabId": 12345, "condition": "element", "selector": "#ready", "state": "visible", "timeoutMs": 5000, "pollMs": 100}

# Assert condition
POST /api/browser/assert
{"tabId": 12345, "selector": "h1", "textContains": "Dashboard"}
```

### Screenshots

```bash
# Capture visible area
GET /api/browser/screenshot?tabId=12345

# Capture full page
GET /api/browser/screenshot?tabId=12345&fullPage=true
```

### Network Capture (headers only)

```bash
# Enable capture
POST /api/browser/network/enable

# Get captured requests
GET /api/browser/network/requests?limit=50&urlPattern=api

# Disable capture
POST /api/browser/network/disable
```

### Network Capture (with response bodies)

Uses Chrome DevTools Protocol. Shows a yellow "debugging" banner on the tab.

```bash
# Enable debugger on a tab
POST /api/browser/debugger/enable
{"tabId": 12345, "mode": "full"}

# Get requests with request/response bodies and headers
GET /api/browser/debugger/requests?tabId=12345&urlPattern=api&limit=20

# Disable debugger
POST /api/browser/debugger/disable
{"tabId": 12345}
```

## Project structure

```
Oko/
├── cli/               # Agent-first Node CLI
├── backend/
│   ├── server.js      # Express + WebSocket server
│   └── package.json
├── extension/
│   ├── background/    # TypeScript source modules
│   │   ├── websocket.ts      # WebSocket connection handling
│   │   ├── browserMcp/       # Browser automation handlers
│   │   └── __tests__/        # Vitest test suite
│   ├── dist/          # Built popup/background scripts
│   ├── picker.js      # Element picker overlay
│   ├── popup.html/js  # Extension popup UI
│   └── manifest.json
├── AGENTS.md          # Notes for AI agents
├── INSTALL.md         # User installation guide
└── README.md
```

## Development

### Extension

```bash
# from repo root (required once per fresh clone)
npm run build:shared

cd extension
npm install
npm run build      # Build background + popup bundles to dist/
npm run typecheck  # Type checking
npm run lint       # ESLint
npm test           # Run vitest tests
```

### Backend

```bash
cd backend
npm install
npm start          # Start server on port 8129
```

### CLI

```bash
cd cli
npm install
npm test

# from repo root
npm run oko -- --help
npm run oko -- test run docs/examples/login-scenario.yaml --strict
```

## Security

### Authentication
- **Token-based auth** required for all remote connections
- Tokens are 256-bit cryptographically random
- **Tokens expire after 24 hours** (configurable via `OKO_TOKEN_EXPIRY_HOURS`)
- Token file written with mode 600 (owner-only read)
- Localhost connections don't require auth (for local development)

### WebSocket Security
- **First-message authentication** - tokens sent in first WebSocket message, not URL query string (avoids logging tokens in server logs, browser history, proxies)
- **5-second auth timeout** - unauthenticated connections are closed after 5 seconds
- Token expiry checked on both HTTP and WebSocket connections

## Known Limitations

### MV3 Service Worker Suspension
Chrome's Manifest V3 can suspend the extension's service worker at any time to save resources. This affects:

- **Network capture** - Captured requests are stored in memory and will be lost on suspension
- **Debugger sessions** - May become orphaned if worker suspends while debugger is attached

**Mitigations:**
- A keepalive alarm runs every 25 seconds during active WebSocket connections
- Debugger capture shows a visible banner, keeping the tab active
- For critical captures, retrieve data frequently rather than accumulating

**Best practices:**
- Disable network/debugger capture when not actively using it
- Retrieve captured requests promptly after the interaction you're monitoring
- Don't rely on captured data persisting across long idle periods

### Data Protection
- Sensitive headers (Authorization, Cookie, Set-Cookie) are **redacted by default**
- Response bodies can contain sensitive data - use `redactHeaders` option to add custom patterns
- Network capture requires explicit opt-in via debugger API
- Captured data is held in memory only, not persisted

### Network Security
- Rate limiting: 100 requests/minute per IP
- CORS restricted to localhost and Gitpod origins
- WebSocket connections require valid token

### Extension Permissions
The Chrome extension requires broad permissions to function:
- `<all_urls>` - Required to capture network traffic and interact with any page
- `debugger` - Required for response body capture
- `tabs`, `scripting` - Required for tab control and element interaction

### Security Considerations

**Connection codes contain the auth token** - treat them as secrets. Don't paste in public channels.

**Network capture sees all traffic** - when debugger is enabled, ALL requests from that tab are captured, including to other domains. The yellow "debugging" banner indicates capture is active.

**Response bodies may contain sensitive data** - PII, tokens, financial data in API responses will be captured. Use domain filtering or disable body capture for sensitive sites.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OKO_AUTH_TOKEN` | Fixed auth token (for production) | Random per-start |
| `OKO_TOKEN_EXPIRY_HOURS` | Token validity period | 24 |

## FAQ

### What can I use Oko for?

**API Reverse Engineering**
- Capture network traffic from any web app to understand its API
- Get full request/response bodies including headers and payloads
- Filter by URL pattern to focus on specific endpoints
- Export captured data for documentation or automation

**Browser Automation**
- Control browser tabs programmatically from your dev environment
- Fill forms, click buttons, and navigate pages via API
- Take screenshots for visual testing or documentation
- Select elements visually and get their selectors

**Testing & Debugging**
- Monitor API calls while interacting with a web app
- Capture authentication flows and token exchanges
- Debug webhook integrations by inspecting payloads
- Verify frontend-backend communication

**Data Extraction**
- Capture paginated API responses as you browse
- Extract data from authenticated sessions
- Monitor real-time updates via WebSocket inspection

### How is this different from browser DevTools?

Oko exposes browser capabilities via REST API, so you can:
- Access browser data from a remote dev environment (Gitpod, Codespaces, SSH)
- Script and automate captures programmatically
- Integrate with other tools and workflows
- Let AI agents interact with your browser

### Can I use this with AI coding assistants?

Yes - Oko is designed to work with AI agents. The API lets agents:
- See what tabs you have open
- Capture network traffic to understand APIs
- Take screenshots to see the current page state
- Click elements and fill forms to interact with web apps

## Troubleshooting

### Connection Issues

**"Cannot reach server" or connection timeout**
- Verify the backend is running (`npm start` in `backend/`)
- Check the URL is correct (include `https://` for remote)
- For Gitpod/Ona: ensure the port is public, not private

**"Auth failed - check token"**
- Token must match exactly (no extra spaces)
- For remote connections, token is required
- Token is in `/tmp/oko-auth-token` or use `OKO_AUTH_TOKEN` env var

**Extension shows "Offline" but backend is running**
- Click "Reconnect" button in popup
- Check browser console for WebSocket errors
- Try closing and reopening the popup

**Badge shows red "!" icon**
- WebSocket disconnected - click popup and hit "Reconnect"
- Backend may have restarted - paste connection code again

### Network Capture Issues

**"No debugger session for this tab"**
- Call `/api/browser/debugger/enable` first with the tab ID
- Debugger sessions expire if the tab navigates or closes

**Requests not being captured**
- Ensure debugger is enabled BEFORE the requests happen
- Check `urlPattern` filter isn't too restrictive
- Some requests (service workers, extensions) may not be captured

**Response bodies are empty or truncated**
- Very large responses may be truncated
- Binary responses (images, files) are not captured
- Check the `responseBody` field exists in the response

### Element Picker Issues

**Picker doesn't activate with Alt+Shift+A**
- Some pages block content scripts (chrome://, extension pages)
- Try refreshing the page
- Check extension has permission for the site

**Selected element not received by backend**
- WebSocket may be disconnected - check connection status
- Element selections are queued if disconnected, sent on reconnect

### Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 401 | Unauthorized | Check auth token |
| 503 | No extension connected | Open extension popup, verify connection |
| 504 | Extension timeout | Extension may be suspended, interact with browser |
| 429 | Rate limited | Wait a minute, reduce request frequency |

## License

MIT

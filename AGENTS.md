# Oko Agent Notes

This repo contains the Oko backend (Node/Express + WebSocket) and the Oko Chrome extension.

## What Oko Does

Oko gives you (the agent) access to the user's browser via REST API. You can:
- List and control browser tabs
- Capture network traffic with full request/response bodies
- Click elements, fill forms, navigate pages
- Take screenshots
- Select elements visually (user triggers with Alt+Shift+A)

## Preferred Agent Interface: CLI

Use the Oko CLI first. It wraps auth, retries, and debugger cleanup:

```bash
# Health + connectivity diagnostics
npm run oko -- doctor

# List tabs
npm run oko -- tabs list

# Capture API traffic from active tab (10s default window)
npm run oko -- capture api --mode full --url-pattern api

# Stream requests as NDJSON in real time (stop with Enter)
npm run oko -- capture api --follow --until-enter --output ndjson

# Capture until Enter and save as JSON
npm run oko -- capture api --until-enter --out capture.json

# Deterministic frontend actions
npm run oko -- browser hover --tab-id 123 --selector "button.submit"
npm run oko -- browser type --tab-id 123 --selector "input[name=email]" --text "test@example.com" --clear
npm run oko -- browser wait --tab-id 123 --condition element --selector "#ready" --state visible
npm run oko -- browser assert --tab-id 123 --selector "h1" --text-contains "Dashboard"

# Declarative scenario run
npm run oko -- test run docs/examples/login-scenario.yaml --strict

# Autonomous API discovery from active logged-in tab
npm run oko -- discover api --active
```

Use REST/curl only when you need low-level control.

## IMPORTANT: Getting Connected

Before using any browser APIs, ensure Oko is connected:

1. **Check if backend is running:** `curl http://localhost:8129/api/health`
2. **If not running:** Start with `gitpod automations service start oko-backend` or `cd backend && npm start`
3. **Get connection code:** Read from backend logs or generate:
   ```bash
   TOKEN=$(cat /tmp/oko-auth-token)
   URL="https://8129--${GITPOD_ENVIRONMENT_ID}.${GITPOD_REGION:-us-east-1-01}.gitpod.dev"
   echo "oko:$(echo -n "${URL}|${TOKEN}" | base64 -w 0)"
   ```
4. **User must paste code in extension popup** - you cannot do this programmatically

## IMPORTANT: Checking Connection Status

Before making browser API calls, verify the extension is connected:
```bash
npm run oko -- doctor
```
If you get `503 No extension connected`, ask the user to:
- Open the Oko extension popup in Chrome
- Paste the connection code
- Verify status shows "Connected"

## Quick setup (for using the extension)

Backend:
- `cd backend`
- `npm install`
- `npm start`

In Ona environments, the backend automatically outputs the extension config (URL + token) on startup.

Extension:
- `npm run build:shared` (from repo root)
- `cd extension`
- `npm install`
- `npm run build`
- Load unpacked in `chrome://extensions` using `extension/`.

## Using the extension

**Quick connect (recommended):**
1. Start the backend - it outputs a connection code like `oko:aHR0cHM6...`
2. Open the Oko popup from the toolbar
3. Paste the connection code into the "Connection Code" field
4. The extension auto-saves and connects

**Manual setup:**
- Open the Oko popup from the toolbar
- Set the backend URL (localhost or the Gitpod/Ona public URL)
- Set the auth token (from `/tmp/oko-auth-token` or `OKO_AUTH_TOKEN`)
- Click Save, then Test Connection

**Local development:**
- The extension auto-detects `localhost:8129` when no remote URL is configured
- No auth token needed for localhost

### Core workflows

- Element picker: press `Alt+Shift+A`, click an element, then use the backend API to read `/api/browser/selected-element`.
- Network capture (headers + bodies): `npm run oko -- capture api --mode full --url-pattern api`.
- Element actions: `npm run oko -- browser click` and `npm run oko -- browser fill`.
- Human-like interactions: `npm run oko -- browser hover|type|key|scroll|wait|assert`.
- Screenshots: `npm run oko -- browser screenshot --tab-id <id> --full-page`.
- Scenario runner: `npm run oko -- test run <scenario.yaml> [--strict]`.
- API discovery runner: `npm run oko -- discover api [--active]`.
- Scenario docs: `docs/testing-scenarios.md`.
- Low-level API passthrough: `npm run oko -- api get|post|delete ...`.

### Debugger-based network capture (with response bodies)

The standard network capture only captures headers. To capture full response bodies, use the debugger API:

1. Get the tab ID: `GET /api/browser/tabs` - find the tab you want to monitor
2. Enable debugger capture: `POST /api/browser/debugger/enable` with `{"tabId": <id>, "mode": "full"}`
   - This shows a yellow "Oko is debugging this tab" banner
3. Browse/interact with the page to trigger requests
4. Get captured requests: `GET /api/browser/debugger/requests?tabId=<id>&urlPattern=<regex>&limit=50`
5. Disable when done: `POST /api/browser/debugger/disable` with `{"tabId": <id>}`

Example:
```bash
# Get tabs
curl -H "X-Auth-Token: $TOKEN" "$URL/api/browser/tabs"

# Enable debugger on tab 12345
curl -X POST -H "X-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/browser/debugger/enable" -d '{"tabId": 12345, "mode": "full"}'

# Get captured requests with response bodies
curl -H "X-Auth-Token: $TOKEN" "$URL/api/browser/debugger/requests?tabId=12345&urlPattern=api&limit=10"

# Disable debugger
curl -X POST -H "X-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/browser/debugger/disable" -d '{"tabId": 12345}'
```

## Repo layout

- `backend/server.js`: API + WebSocket server, auth, and request routing.
- `extension/background/`: TypeScript sources for the service worker.
- `extension/background.js`: bundled output used by the extension.
- `extension/picker.js` + `popup.html`/`popup.js`: UI and content scripts.
- `extension/manifest.json`: MV3 manifest and permissions.

## Useful commands

- Extension build: `npm run build`
- Extension typecheck: `npm run typecheck`
- Extension lint: `npm run lint`

## Common Tasks

### Capture API traffic from a website
1. `npm run oko -- tabs list` (optional if you need exact tab ID)
2. `npm run oko -- capture api --active --mode full --url-pattern api --until-enter`
3. Ask user to interact with the website
4. Press Enter to stop capture (CLI disables debugger automatically)

### Take a screenshot
```bash
curl -H "X-Auth-Token: $TOKEN" "http://localhost:8129/api/browser/screenshot?tabId=<id>&fullPage=true"
```
Response contains base64-encoded PNG.

### Click an element
```bash
curl -X POST -H "X-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  "http://localhost:8129/api/browser/click" -d '{"tabId": <id>, "selector": "button.submit"}'
```

### Fill a form field
```bash
curl -X POST -H "X-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  "http://localhost:8129/api/browser/fill" -d '{"tabId": <id>, "selector": "input[name=email]", "value": "test@example.com"}'
```

## Error Handling

| Error | Meaning | Solution |
|-------|---------|----------|
| 503 "No extension connected" | Extension not connected to backend | Ask user to open popup and paste connection code |
| 504 "Extension timeout" | Extension didn't respond | Extension may be suspended; ask user to interact with browser |
| 401 "Unauthorized" | Invalid or missing token | Check token matches `/tmp/oko-auth-token` |
| "No debugger session" | Debugger not enabled for tab | Call `/api/browser/debugger/enable` first |

## Anti-patterns

- **DON'T** assume the extension is connected - always check first
- **DON'T** try to automate extension setup - user must paste connection code manually
- **DON'T** forget to disable debugger when done - it shows a yellow banner to the user
- **DON'T** use localhost URLs when telling user about the backend - use the Gitpod URL

# Oko Agent Notes

This repo contains the Oko backend (Node/Express + WebSocket) and the Oko Chrome extension.

## What Oko Does

Oko gives you (the agent) access to the user's browser via REST API. You can:
- List and control browser tabs
- Capture network traffic with full request/response bodies
- Click elements, fill forms, navigate pages
- Take screenshots
- Select elements visually (user triggers with Alt+Shift+A)

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
curl -H "X-Auth-Token: $TOKEN" "http://localhost:8129/api/browser/tabs"
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
- Network capture (headers only): call `/api/browser/network/enable`, then `/api/browser/network/requests` to read results.
- Network capture (with response bodies): use the debugger API - see below.
- Element actions: call `/api/browser/element-info`, `/api/browser/click`, or `/api/browser/fill`.
- Screenshots: call `/api/browser/screenshot` (use `fullPage=true` when needed).

### Debugger-based network capture (with response bodies)

The standard network capture only captures headers. To capture full response bodies, use the debugger API:

1. Get the tab ID: `GET /api/browser/tabs` - find the tab you want to monitor
2. Enable debugger capture: `POST /api/browser/debugger/enable` with `{"tabId": <id>}`
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
  "$URL/api/browser/debugger/enable" -d '{"tabId": 12345}'

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
1. Get tab ID: `GET /api/browser/tabs` - find the target tab
2. Enable debugger: `POST /api/browser/debugger/enable` with `{"tabId": <id>}`
3. Ask user to interact with the website
4. Fetch requests: `GET /api/browser/debugger/requests?tabId=<id>&urlPattern=api&limit=100`
5. Disable debugger: `POST /api/browser/debugger/disable` with `{"tabId": <id>}`

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

# Oko Agent Notes

This repo contains the Oko backend (Node/Express + WebSocket) and the Oko Chrome extension.

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

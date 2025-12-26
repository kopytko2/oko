# Oko

Oko is a Chrome extension + backend that lets you automate and inspect your live browser from a local or remote development environment (Ona/Gitpod). It captures network activity, inspects DOM elements, and triggers browser actions without running a separate browser instance.

## What this repo contains

- `backend/`: Node/Express + WebSocket server that brokers API requests to the extension.
- `extension/`: MV3 Chrome extension that performs browser actions and reports back.
- Docs: security notes, QA checklist, and planning docs.

## How it works

1. The backend runs on port `8129` and exposes REST endpoints.
2. The extension maintains a WebSocket connection to the backend.
3. API calls (e.g., screenshot, click, network capture) are forwarded to the extension and returned as responses.

## Quick start (local)

```bash
# Start backend
cd backend
npm install
npm start

# Build extension
cd ../extension
npm install
npm run build

# Load extension in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Load unpacked -> select extension/ folder
```

## Quick start (Ona/Gitpod)

```bash
# In Ona environment
export OKO_AUTH_TOKEN=$(openssl rand -hex 32)
cd backend && npm install && npm start

# Expose port
gitpod environment port open 8129
```

Then open the extension popup and set:
- Backend URL (the public URL from the port open command)
- Auth token (`OKO_AUTH_TOKEN`)
- Click Test Connection

## Using it (core workflows)

- Element picker: press `Alt+Shift+A`, click an element, then call `/api/browser/selected-element`.
- Network capture (headers): `POST /api/browser/network/enable`, then `GET /api/browser/network/requests`.
- Network capture (with bodies): Use debugger API - see below.
- Element actions: `POST /api/browser/element-info`, `/api/browser/click`, `/api/browser/fill`.
- Screenshots: `GET /api/browser/screenshot` (use `fullPage=true` when needed).

## Debugger-based network capture

To capture full response bodies (not just headers), use the debugger API. This attaches Chrome DevTools Protocol to a tab and captures complete request/response data.

```bash
# 1. Get tab ID
curl -H "X-Auth-Token: $TOKEN" "$URL/api/browser/tabs"

# 2. Enable debugger capture on a tab
curl -X POST -H "X-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/browser/debugger/enable" -d '{"tabId": 12345}'

# 3. Browse the page to generate traffic, then fetch captured requests
curl -H "X-Auth-Token: $TOKEN" \
  "$URL/api/browser/debugger/requests?tabId=12345&urlPattern=api&limit=20"

# 4. Disable when done
curl -X POST -H "X-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/browser/debugger/disable" -d '{"tabId": 12345}'
```

Note: A yellow banner "Oko is debugging this tab" appears while debugger is attached.

## Security highlights

- Token-based auth for remote access.
- Rate limiting (100 req/min).
- Header redaction for sensitive data.
- CORS restricted to known origins.

## Project structure

```
Oko/
├── backend/
│   ├── server.js
│   └── package.json
├── extension/
│   ├── background/
│   ├── components/
│   ├── lib/
│   └── manifest.json
├── SECURITY.md
├── QA_CHECKLIST.md
└── README.md
```

## Docs

- [Security](SECURITY.md) - Authentication, rate limiting, data protection
- [QA Checklist](QA_CHECKLIST.md) - Testing scenarios and verification
- [Integration Plan](ONA_INTEGRATION_PLAN.md) - Original design document
- [Tickets](ONA_INTEGRATION_TICKETS.md) - Implementation tickets

## License

MIT

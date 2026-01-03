# Oko

Oko is a Chrome extension + backend that lets you automate and inspect your browser from a development environment. Control tabs, capture network traffic, click elements, fill forms, and take screenshots - all via REST API.

## Features

- **Navigate** - Open URLs in new or existing tabs
- **Network capture** - Capture requests with headers, or full response bodies via debugger
- **Element picker** - Select elements visually with `Alt+Shift+O`
- **Screenshots** - Capture visible area or full page
- **DOM interaction** - Click elements, fill inputs, get element info

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

Open the Oko extension popup, paste the URL and token, click **Test** then **Save**.

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
{"tabId": 12345}

# Get requests with full response bodies
GET /api/browser/debugger/requests?tabId=12345&urlPattern=api&limit=20

# Disable debugger
POST /api/browser/debugger/disable
{"tabId": 12345}
```

## Project structure

```
Oko/
├── backend/
│   ├── server.js      # Express + WebSocket server
│   └── package.json
├── extension/
│   ├── background.js  # Service worker
│   ├── picker.js      # Element picker overlay
│   ├── popup.html/js  # Extension popup UI
│   └── manifest.json
├── AGENTS.md          # Notes for AI agents
└── README.md
```

## Security

- Token-based authentication for remote access
- Rate limiting (100 requests/minute)
- Sensitive headers (Authorization, Cookie) are redacted in captures
- CORS restricted to localhost and Gitpod origins

## License

MIT

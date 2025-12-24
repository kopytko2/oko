# Oko

Browser automation tools for Ona development environments.

## Overview

Oko provides browser automation capabilities (network capture, DOM inspection, element interaction) that can be controlled from remote Ona environments. Unlike tools that require a separate browser instance, Oko works with your actual Chrome session.

## Architecture

```
┌─────────────────────┐                    ┌─────────────────────────────────┐
│  Chrome Extension   │     HTTPS/WSS     │  Ona Environment                │
│  (Your browser)     │ ←───────────────→ │  ┌─────────────────────────┐    │
│                     │   Public URL      │  │  Oko Backend            │    │
│  - Network capture  │                   │  │  Port 8129              │    │
│  - DOM inspection   │                   │  │                         │    │
│  - Element actions  │                   │  └─────────────────────────┘    │
└─────────────────────┘                   └─────────────────────────────────┘
```

## Quick Start

### Local Development

```bash
# Start backend
cd backend
npm install
npm start

# Build extension
cd extension
npm install
npm run build

# Load extension in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Load unpacked -> select extension/ folder
```

### Ona Environment

```bash
# In Ona environment
export OKO_AUTH_TOKEN=$(openssl rand -hex 32)
cd backend && npm install && npm start

# Expose port
gitpod environment port open 8129

# In extension settings:
# - Enter the public URL
# - Enter the auth token
# - Click Test Connection
```

## Features

### Network Capture
- Capture XHR/fetch and static asset requests
- Request/response headers with automatic redaction
- Timing data (start, end, duration)
- URL filtering and pagination

### Elements Inspection
- Query elements by CSS selector
- Get bounds, computed styles, visibility
- Click and fill actions
- Visual highlight feedback

### Security
- Token-based authentication for remote access
- Rate limiting (100 req/min)
- Header redaction for sensitive data
- CORS restricted to known origins

## Project Structure

```
Oko/
├── backend/
│   ├── server.js          # Express + WebSocket server
│   └── package.json
├── extension/
│   ├── background/
│   │   ├── index.ts       # Service worker entry
│   │   ├── state.ts       # Shared state
│   │   ├── websocket.ts   # WebSocket connection
│   │   └── browserMcp/
│   │       ├── network.ts # Network capture
│   │       └── elements.ts # DOM inspection
│   ├── components/
│   │   └── ConnectionSettings.tsx
│   ├── lib/
│   │   ├── api.ts         # API utilities
│   │   └── connection.ts  # Connection settings
│   └── manifest.json
├── SECURITY.md
├── QA_CHECKLIST.md
└── README.md
```

## Documentation

- [Security](SECURITY.md) - Authentication, rate limiting, data protection
- [QA Checklist](QA_CHECKLIST.md) - Testing scenarios and verification
- [Integration Plan](ONA_INTEGRATION_PLAN.md) - Original design document
- [Tickets](ONA_INTEGRATION_TICKETS.md) - Implementation tickets

## License

MIT

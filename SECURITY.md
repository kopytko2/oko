# Oko Security

Security considerations for running Oko with remote Ona environments.

## Authentication

### Local Development (localhost)
- No authentication required by default
- Random token generated on startup, written to `/tmp/oko-auth-token`
- Extension reads token automatically

### Remote/Ona Environments
- Set `OKO_AUTH_TOKEN` environment variable before starting backend
- Enter the same token in the extension's Connection Settings
- All API and WebSocket connections require valid token

```bash
# In Ona environment
export OKO_AUTH_TOKEN=$(openssl rand -hex 32)
npm start
```

## Data Protection

### Auth Token Storage
- Auth tokens stored in `chrome.storage.local` (device-specific, not synced)
- Backend URL stored in `chrome.storage.sync` (synced across devices, not sensitive)

### Network Capture Redaction
Headers automatically redacted by default:
- `Authorization`
- `Cookie`
- `Set-Cookie`
- `X-Auth-Token`

Custom redaction list can be configured when enabling capture:
```javascript
{
  redactHeaders: ['authorization', 'cookie', 'x-api-key', 'x-custom-secret']
}
```

### Response Body Capture
- Response bodies are NOT captured by default (webRequest API limitation)
- Only request/response headers and metadata are stored
- HTML content in element inspection is truncated to 5000 characters

## Rate Limiting

### Browser API Endpoints
- 100 requests per minute per IP
- Applies to all `/api/browser/*` endpoints
- Returns 429 with retry-after header when exceeded

### WebSocket Connections
- No connection rate limit (single persistent connection expected)
- Message handling is synchronous (natural backpressure)

## CORS Policy

Allowed origins:
- `chrome-extension://*` - Chrome extensions
- `*.gitpod.dev` - Gitpod/Ona environments
- `*.gitpod.io` - Gitpod/Ona environments  
- `localhost:*` - Local development
- `127.0.0.1:*` - Local development

All other origins are rejected.

## Network Security

### Localhost Detection
- Uses `req.socket.remoteAddress` (not spoofable `Host` header)
- Checks for `127.0.0.1`, `::1`, `::ffff:127.0.0.1`

### Private Network Access
- Supports Chrome's Private Network Access preflight
- `Access-Control-Allow-Private-Network: true` header set

### WebSocket Authentication
- Token passed via query parameter: `ws://host?token=xxx`
- Invalid tokens result in immediate close with code 4001
- No unauthenticated connections allowed for remote hosts

## Recommendations

### For Production Use
1. Always set `OKO_AUTH_TOKEN` environment variable
2. Use HTTPS/WSS via Ona port forwarding
3. Rotate tokens periodically
4. Monitor rate limit hits for abuse detection

### For Development
1. Localhost mode is convenient but less secure
2. Don't expose port 8129 publicly without auth token
3. Use SSH tunnel as alternative to public port exposure

## Reporting Security Issues

Report security vulnerabilities privately. Do not open public issues for security bugs.

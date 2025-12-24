# Oko QA Checklist

## Pre-Release Verification

### Build & Setup
- [ ] `npm install` in backend/ completes without errors
- [ ] `npm install` in extension/ completes without errors
- [ ] `npm run build` in extension/ completes without errors
- [ ] `npm run typecheck` in extension/ passes
- [ ] Extension loads in Chrome without manifest errors

### Connection Scenarios

#### Localhost (Default)
- [ ] Backend starts on port 8129
- [ ] Extension connects automatically
- [ ] No auth token required
- [ ] Health check returns `{ status: 'ok' }`

#### Ona Port Forwarding
- [ ] Set `OKO_AUTH_TOKEN` environment variable
- [ ] Run `gitpod environment port open 8129`
- [ ] Enter public URL in extension settings
- [ ] Enter auth token in extension settings
- [ ] Test Connection shows success with latency
- [ ] WebSocket connects over WSS

#### SSH Tunnel
- [ ] `gitpod environment ssh <env-id> -L 8129:localhost:8129`
- [ ] Extension connects to localhost:8129
- [ ] Tunnel remains stable during use

### Network Capture (OKO-005)
- [ ] Enable capture via API
- [ ] XHR/fetch requests are captured
- [ ] Static asset requests are captured
- [ ] Request headers are captured
- [ ] Response headers are captured
- [ ] Sensitive headers are redacted (Authorization, Cookie)
- [ ] Timing data (startTime, endTime, durationMs) is recorded
- [ ] URL filtering works at capture time
- [ ] Pagination works (offset, limit)
- [ ] Clear requests works
- [ ] Max requests limit enforced (oldest evicted)

### Elements Inspection (OKO-006)
- [ ] Get element info by selector
- [ ] Bounds (x, y, width, height) are accurate
- [ ] Computed styles are returned
- [ ] Visibility detection works
- [ ] Click element works
- [ ] Fill input works (input, textarea)
- [ ] React/Vue input events fire correctly
- [ ] Highlight element shows visual feedback
- [ ] HTML truncation works for large elements

### Security (OKO-007)
- [ ] Auth token required for remote connections
- [ ] Invalid token returns 401
- [ ] Rate limiting triggers at 100 req/min
- [ ] CORS rejects unauthorized origins
- [ ] WebSocket rejects unauthorized connections (4001)
- [ ] Localhost bypass only works for actual localhost

### Error Handling
- [ ] Invalid URL shows clear error
- [ ] Connection timeout shows clear error
- [ ] Element not found shows clear error
- [ ] Network errors don't crash extension

## Known Limitations

### Browser Limitations
- Cannot capture response bodies (webRequest API limitation)
- Cannot screenshot Chrome sidebar (Chrome limitation)
- Some sites block script injection (CSP)

### Architecture Limitations
- Single backend connection per extension instance
- Network capture is in-memory (lost on extension reload)
- No persistence of captured data across sessions

## Test Commands

```bash
# Start backend
cd backend && npm install && npm start

# Test health endpoint
curl http://localhost:8129/api/health

# Test with auth token
export OKO_AUTH_TOKEN=test123
curl -H "X-Auth-Token: test123" http://localhost:8129/api/auth/token

# Test rate limiting (run 101 times quickly)
for i in {1..101}; do curl -s http://localhost:8129/api/browser/tabs; done
```

## Release Checklist

- [ ] All QA scenarios pass
- [ ] SECURITY.md is up to date
- [ ] Version bumped in manifest.json and package.json
- [ ] CHANGELOG updated
- [ ] No console errors in extension
- [ ] No unhandled promise rejections in backend

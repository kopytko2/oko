# Oko Ona Integration Tickets (Browser-only: Network + Elements)

Scope: allow Ona agents to drive and inspect a live browser session (tabs, screenshots, DOM, network) without terminal/tmux features.
Out of scope: terminal/tmux UI, file/audio features, Sources, Coverage, Performance tracing.

## Ticket OKO-001: Connection Settings Module

Goal: centralize backend URL + auth token and compute API/WS URLs.

Scope:
- Add `extension/lib/api.ts` + `extension/lib/connection.ts`.
- Store backend URL in `chrome.storage.sync`, auth token in `chrome.storage.local`.
- Normalize URLs (auto-prepend `https://` if missing scheme).
- Cache settings and clear cache on `chrome.storage.onChanged`.

Acceptance criteria:
- `getApiUrl()` and `getWsUrl()` return the configured URLs and default to `http://localhost:8129`.
- Invalid URLs are rejected with a clear error message.

Dependencies: none.

Effort: 2-3 hours.

## Ticket OKO-002: Extension Uses Configured URLs

Goal: remove hardcoded `localhost:8129` from browser-only paths.

Scope:
- Update `extension/background/websocket.ts`, `extension/background/state.ts`, `extension/shared/consoleForwarder.ts`.
- Use `getApiUrl()`/`getWsUrl()` and `new URL()` for path joins.
- Add auth header to HTTP calls when a token is configured.
- Update `extension/manifest.json` host permissions for Ona/Gitpod domains.

Acceptance criteria:
- All browser-only endpoints use configured URLs.
- Extension can connect to an Ona public URL without manual code edits.

Dependencies: OKO-001.

Effort: 2-3 hours.

## Ticket OKO-003: Connection Settings UI

Goal: let users configure backend URL and auth token in the UI.

Scope:
- Add a Connection tab in `extension/components/SettingsModal.tsx`.
- Provide URL validation, test connection button, and save action.
- Clarify Ona steps and `OKO_AUTH_TOKEN` usage in helper text.

Acceptance criteria:
- Settings persist across reloads.
- Test connection reports success/failure within 5 seconds.

Dependencies: OKO-001.

Effort: 2 hours.

## Ticket OKO-004: Backend Auth, Health, and CORS

Goal: secure remote access and support connection checks.

Scope:
- Add `OKO_AUTH_TOKEN` support in `backend/server.js`.
- Add `/api/health` endpoint for connectivity checks.
- Validate WS connections with the token.
- Add HTTP auth middleware for `/api/browser/*` endpoints.
- Restrict CORS to Chrome extension + Ona/Gitpod + localhost.

Acceptance criteria:
- Requests without a valid token are rejected.
- `/api/health` returns `{ status: 'ok' }` on success.

Dependencies: OKO-001.

Effort: 1-2 hours.

## Ticket OKO-005: Network Capture API (Browser MCP)

Goal: expose DevTools-like network data to Ona agents.

Scope:
- Confirm `chrome.webRequest` capture is wired for enable/get/clear.
- Add or verify backend routes for network capture under `/api/browser`.
- Add redaction for cookies/authorization headers.
- Enforce size limits and max retention on captured requests.

Acceptance criteria:
- Agent can enable capture, fetch paginated results, and clear logs.
- Sensitive headers are redacted by default.

Dependencies: OKO-002, OKO-004.

Effort: 2-3 hours.

## Ticket OKO-006: Elements Inspection API (Browser MCP)

Goal: expose DOM inspection and element info.

Scope:
- Verify `browser-get-element-info`, `browser-click-element`, `browser-fill-input` handlers.
- Add or verify backend routes for element info and DOM tree.
- Return bounds, computed styles, and limited HTML snippets.
- Optional: highlight inspected elements in the page.

Acceptance criteria:
- Agent can query element info by selector and get styles + bounds.
- Click/fill actions succeed with visual confirmation.

Dependencies: OKO-002, OKO-004.

Effort: 2-3 hours.

## Ticket OKO-007: Security Pass

Goal: reduce leakage risk for a publicly exposed backend.

Scope:
- Store auth tokens in `chrome.storage.local` only.
- Redact response bodies and sensitive headers by default.
- Add allowlist for network capture domains (optional toggle).
- Add request rate limits for browser endpoints (optional).

Acceptance criteria:
- No secrets are returned by default endpoints.
- Security toggles are documented in settings or config.

Dependencies: OKO-004.

Effort: 1-2 hours.

## Ticket OKO-008: QA + Release Checklist

Goal: validate browser-only functionality end to end.

Scope:
- Test localhost, Ona port-forwarded URL, and SSH tunnel.
- Validate network capture on XHR/fetch and static assets.
- Validate element inspection, click, and fill.
- Document known limitations and failure modes.

Acceptance criteria:
- All scenarios pass with clear repro steps.
- Docs updated with the final connection setup.

Dependencies: OKO-002 through OKO-006.

Effort: 2 hours.

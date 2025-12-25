# Element Picker Overlay - Implementation Plan

## Overview

Add a visual element picker to Oko that lets users select page elements and send their selectors to the backend for use in automation commands.

## User Flow

1. User presses `Alt+Shift+O` (or clicks extension icon menu)
2. Picker overlay activates - cursor changes, banner appears (idempotent toggle)
3. User hovers over elements - orange outline highlights current element
4. Tooltip shows: selector preview, tag name, dimensions
5. User clicks element - info sent to backend via WebSocket
   - If the target is an iframe: default selects the iframe element
   - If the iframe is same-origin: allow "enter frame" mode (e.g., Ctrl/Cmd+Click) to pick inside
6. Picker deactivates, confirmation shown
7. Ona agent receives element info and can use it for commands

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Content Script (picker.js) - Injected into page               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │  Overlay UI     │  │  Hover Handler  │  │  Click Handler │  │
│  │  - Banner       │  │  - Highlight    │  │  - Capture     │  │
│  │  - Tooltip      │  │  - Selector gen │  │  - Send msg    │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ chrome.runtime.sendMessage
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Background Service Worker                                       │
│  - Receives element selection                                    │
│  - Forwards to backend via WebSocket                            │
│  - Queues messages if WS disconnected (reconnect logic exists)  │
│  - Uses chrome.alarms for keepalive (already implemented)       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend Server                                                  │
│  - Receives element-selected event                              │
│  - Stores last selected element                                 │
│  - Exposes via /api/browser/selected-element                    │
└─────────────────────────────────────────────────────────────────┘
```

## Files to Create/Modify

### New Files

1. **extension/picker.js** - Picker logic (injected on-demand, not persistent content script)
2. **extension/picker.css** - Styles for overlay, highlight, tooltip (injected with script)

### Modified Files

1. **extension/manifest.json** - Add commands (keyboard shortcut), NO content_scripts
2. **extension/background.js** - Handle shortcut, inject picker via chrome.scripting.executeScript
3. **backend/server.js** - Add selected-element storage and endpoint

## Implementation Details

### 1. Content Script (picker.js)

```javascript
// State
let pickerActive = false
let highlightedElement = null
let overlayElements = { banner: null, tooltip: null, highlight: null }

// Selector generation strategy (in priority order)
function generateSelector(element) {
  // 1. ID (if unique)
  if (element.id && isUniqueSelector(`#${CSS.escape(element.id)}`)) {
    return `#${CSS.escape(element.id)}`
  }
  
  // 2. data-testid or data-cy (testing attributes)
  if (element.dataset.testid) {
    const selector = `[data-testid="${element.dataset.testid}"]`
    if (isUniqueSelector(selector)) return selector
  }
  if (element.dataset.cy) {
    const selector = `[data-cy="${element.dataset.cy}"]`
    if (isUniqueSelector(selector)) return selector
  }
  
  // 3. Unique class combination
  // 4. Tag + nth-child path
  // 5. Full path from root (fallback)
  
  return buildPathSelector(element)
}

// Activation
function activatePicker() {
  pickerActive = true
  createOverlayUI()
  document.addEventListener('mouseover', onHover, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange, true)
}

// Toggle
function togglePicker() {
  if (pickerActive) {
    deactivatePicker()
    return
  }
  activatePicker()
}

// Event handlers - MUST prevent default and stop propagation
function onClick(e) {
  if (!pickerActive) return
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
  
  captureElement(e.target)
  deactivatePicker()
}

function onKeyDown(e) {
  if (!pickerActive) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    deactivatePicker()
  }
  if (e.key === 'Enter' && highlightedElement) {
    e.preventDefault()
    e.stopPropagation()
    captureElement(highlightedElement)
    deactivatePicker()
  }
}

// Deactivation
function deactivatePicker() {
  pickerActive = false
  removeOverlayUI()
  document.removeEventListener('mouseover', onHover, true)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange, true)
}
```

### 2. Overlay UI Elements

**Banner** (top of page):
```
┌─────────────────────────────────────────────────────────────┐
│  🎯 Element Picker Active - Click to select | ESC to cancel │
└─────────────────────────────────────────────────────────────┘
```

**Highlight** (around hovered element):
- 2px solid orange outline
- Semi-transparent orange background (rgba)
- Follows element bounds via getBoundingClientRect()
- `pointer-events: none` to avoid intercepting clicks
- Recalculate on scroll/resize even without mouse movement

**Tooltip** (near cursor):
```
┌─────────────────────────┐
│ button.btn-primary      │
│ 120 × 40 px             │
└─────────────────────────┘
```
- `pointer-events: none` to avoid intercepting clicks

### 3. Selector Generation Strategy

Priority order for generating stable selectors:

| Priority | Strategy | Example |
|----------|----------|---------|
| 1 | ID | `#submit-btn` |
| 2 | data-testid | `[data-testid="login-form"]` |
| 3 | data-cy / data-test / data-qa | `[data-cy="username"]` |
| 4 | name attribute | `[name="email"]` |
| 5 | aria-label | `[aria-label="Submit form"]` |
| 6 | role + accessible name | `[role="button"][aria-label="Save"]` |
| 7 | placeholder (inputs) | `input[placeholder="Enter email"]` |
| 8 | Unique class | `.unique-component-class` |
| 9 | Tag + classes | `button.btn.btn-primary` |
| 10 | Structural | `form > div:nth-child(2) > input` |

Validation: Always verify uniqueness within the correct root
- Light DOM: `document.querySelectorAll(selector).length === 1`
- Shadow DOM: validate within each shadow root hop (see below)

**Shadow DOM handling**:
- Detect if element is inside shadow root via `element.getRootNode()`
- For shadow DOM elements, generate Playwright-style selector: `host-selector >>> inner-selector`
- Example: `my-component >>> button.inner-btn`
- Store `shadowPath` array for elements crossing shadow boundaries
- Validation for shadow selectors should not use `document.querySelectorAll` (it will throw). Instead, resolve each hop (host -> shadowRoot -> inner selector) and ensure a single match at each step.

### 4. Data Sent on Selection

```typescript
interface SelectedElement {
  selector: string           // Generated CSS selector
  tagName: string           // e.g., "button"
  id?: string               // Element ID if present
  className?: string        // Class list
  innerText?: string        // Truncated to 100 chars, scrubbed
  safeAttributes: Record<string, string>  // Allowlisted attributes only
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  timestamp: number
  pageUrl: string           // Origin only, no path/query for privacy
  pageTitle: string
  tabId: number             // For scoping (added by background)
  sessionId: string         // For multi-user safety (added by background)
}

Note: content script sends element data only; background attaches `tabId` from sender and `sessionId` derived from auth token.

// Attribute allowlist - only these are sent
const SAFE_ATTRIBUTES = [
  'id', 'class', 'name', 'type', 'role', 'aria-label', 'aria-labelledby',
  'placeholder', 'alt', 'title', 'for',
  'data-testid', 'data-cy', 'data-test', 'data-qa'
]

// URL attributes - sanitize to origin + path (strip query/hash which may contain tokens)
const URL_ATTRIBUTES = ['href', 'src']

function sanitizeUrlAttribute(url, baseUrl) {
  try {
    // Handle relative URLs by resolving against page base
    const parsed = new URL(url, baseUrl || document.baseURI)
    return parsed.origin + parsed.pathname // Keep origin + path, strip query/hash
  } catch {
    return '[invalid-url]'
  }
}

// Explicitly excluded (sensitive)
const REDACTED_ATTRIBUTES = [
  'value', 'data-token', 'data-auth', 'data-secret', 'data-password'
]
```

### 5. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Alt+Shift+O` | Toggle picker on/off |
| `ESC` | Cancel picker |
| `Enter` | Select currently highlighted element |
| `Ctrl+Click` / `Cmd+Click` | If same-origin iframe, enter frame to pick inside |

### 6. Manifest Changes

```json
{
  "permissions": [
    "activeTab",
    "scripting"
  ],
  "commands": {
    "toggle-picker": {
      "suggested_key": {
        "default": "Alt+Shift+O"
      },
      "description": "Toggle element picker"
    }
  }
}
```

**On-demand injection** (not persistent content script):
- Use `activeTab` permission - only grants access when user activates picker
- Inject via `chrome.scripting.executeScript()` when shortcut pressed
- Reduces privacy risk - no script running on all pages by default
- Explicitly skip restricted URLs: `chrome://`, `chrome-extension://`, `edge://`, etc.
- Ensure idempotent toggle: if picker is already active in the tab, send a message to deactivate instead of reinjecting and duplicating listeners.

### 7. Backend Endpoint

```javascript
// Store selected elements per session (not global)
// Key: sessionId (from auth token hash), Value: { element, timestamp }
const selectedElements = new Map()

// Auto-expire after 5 minutes
const SELECTION_TTL_MS = 5 * 60 * 1000

function getSessionId(req) {
  // Derive from auth token to scope per-user
  const token = req.headers['x-auth-token'] || ''
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
}

app.get('/api/browser/selected-element', requireAuth, (req, res) => {
  const sessionId = getSessionId(req)
  const entry = selectedElements.get(sessionId)
  
  if (!entry || Date.now() - entry.timestamp > SELECTION_TTL_MS) {
    selectedElements.delete(sessionId)
    return res.json({ success: false, error: 'No element selected' })
  }
  
  res.json({ success: true, element: entry.element })
})

// Clear selection
app.delete('/api/browser/selected-element', requireAuth, (req, res) => {
  const sessionId = getSessionId(req)
  selectedElements.delete(sessionId)
  res.json({ success: true })
})

// When receiving selection from extension WebSocket:
function handleElementSelected(message, sessionId) {
  selectedElements.set(sessionId, {
    element: message.element,
    timestamp: Date.now()
  })
}
```

## Edge Cases

1. **iframes** - Default selects the iframe element itself (best UX for cross-origin). If iframe is same-origin, allow user to enter the frame (Ctrl/Cmd+Click) to pick inside; show hint in tooltip.

2. **Shadow DOM** - Elements inside shadow roots need special handling. Use `element.shadowRoot` traversal.

3. **Dynamic elements** - Elements that disappear on blur (dropdowns, tooltips). Add "freeze" mode with Shift key.

4. **Overlapping elements** - Multiple elements at same position. Could add scroll-wheel to cycle through stack.

5. **SVG elements** - Need different selector strategy (no classes typically). Use structural selectors.

6. **Very long selectors** - Cap at reasonable length, prefer shorter unique selectors.

## Testing Checklist

- [ ] Picker activates/deactivates with keyboard shortcut
- [ ] Hover highlight follows cursor correctly
- [ ] Tooltip shows accurate selector and dimensions
- [ ] Click captures element and sends to backend
- [ ] ESC cancels picker
- [ ] Enter selects currently highlighted element
- [ ] Toggle shortcut is idempotent (no duplicate overlays/listeners)
- [ ] Iframe selection works; same-origin "enter frame" mode works
- [ ] Shadow DOM selectors validate without `document.querySelectorAll`
- [ ] Works on complex sites (GitHub, Twitter, etc.)
- [ ] Doesn't interfere with page functionality when inactive
- [ ] Handles pages with strict CSP (Content Security Policy)

## Effort Estimate

| Task | Time |
|------|------|
| Content script (picker.js) | 2-3 hours |
| Styles (picker.css) | 30 min |
| Selector generation logic | 1-2 hours |
| Background script integration | 30 min |
| Backend endpoint | 30 min |
| Testing & edge cases | 1-2 hours |
| **Total** | **6-9 hours** |

## Future Enhancements

1. **Multi-select mode** - Select multiple elements, get common selector pattern
2. **Selector editor** - Edit/refine selector before sending
3. **History** - Show recently selected elements
4. **Copy to clipboard** - Option to just copy selector without sending
5. **Visual diff** - Highlight what the selector matches vs what was clicked

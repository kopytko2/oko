# Oko Review

## Findings

- High: `browser-get-element-info` returns raw attributes and `innerHTML`/`outerHTML` without allowlist/redaction, which can leak secrets/PII from pages to remote clients. (`Oko/extension/background.js:487`, `Oko/extension/background.js:506`)
- Medium: Auth tokens are accepted via query params for HTTP endpoints, which can leak tokens via logs/referrers/history. (`Oko/backend/server.js:129`, `Oko/backend/server.js:254`)
- Medium: Element picker can’t select inside iframes or enter same-origin frames; injection is top-frame only and click handling has no iframe/ctrl-cmd path, so clicks inside frames are missed. (`Oko/extension/background.js:641`, `Oko/extension/picker.js:434`)
- Medium: Shadow DOM selector generation uses document-level uniqueness and a structural fallback not validated against shadow roots, so selectors can be non-unique or invalid within shadow DOM. (`Oko/extension/picker.js:67`, `Oko/extension/picker.js:244`)
- Low: Picker UX gaps: no Enter-to-select, highlight/tooltip only update on `mouseover` (drift on scroll/mousemove), and cursor restore resets to empty string instead of the prior value. (`Oko/extension/picker.js:360`, `Oko/extension/picker.js:449`, `Oko/extension/picker.js:585`)
- Low: Build output mismatch—Vite writes `dist/` but manifest points at root `background.js`, risking stale runtime code if build output isn’t copied. (`Oko/extension/vite.config.ts:8`, `Oko/extension/manifest.json:18`)

## Questions/Assumptions

- Should element-info data be redacted/allowlisted like the picker, or is full HTML/attributes expected?
- Is there a packaging step that copies `dist/background.js` to `extension/background.js`, or should the manifest reference `dist/background.js`?

## Testing Gaps

- Not run here; recommend manual checks for picker behavior in iframes and shadow DOM, and a sanity check on element-info data exposure paths.

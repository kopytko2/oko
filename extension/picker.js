/**
 * Oko Element Picker
 * Visual element selector that sends element info to backend
 * Injected on-demand via chrome.scripting.executeScript
 */

(function() {
  // Prevent double-injection
  if (window.__okoPickerActive) {
    window.__okoDeactivatePicker?.()
    return
  }
  window.__okoPickerActive = true

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================

  const SAFE_ATTRIBUTES = [
    'id', 'class', 'name', 'type', 'role', 'aria-label', 'aria-labelledby',
    'placeholder', 'alt', 'title', 'for',
    'data-testid', 'data-cy', 'data-test', 'data-qa'
  ]

  const URL_ATTRIBUTES = ['href', 'src']

  const REDACTED_ATTRIBUTES = [
    'value', 'data-token', 'data-auth', 'data-secret', 'data-password'
  ]

  // ==========================================================================
  // STATE
  // ==========================================================================

  let highlightedElement = null
  let overlayElements = {}

  // ==========================================================================
  // SELECTOR GENERATION
  // ==========================================================================

  /**
   * Sanitize URL attributes - keep origin + path, strip query/hash
   */
  function sanitizeUrlAttribute(url) {
    try {
      const parsed = new URL(url, document.baseURI)
      return parsed.origin + parsed.pathname
    } catch {
      return '[invalid-url]'
    }
  }

  /**
   * Escape CSS selector special characters
   */
  function cssEscape(str) {
    if (window.CSS?.escape) {
      return CSS.escape(str)
    }
    return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1')
  }

  /**
   * Check if selector uniquely identifies one element
   */
  function isUniqueSelector(selector) {
    try {
      return document.querySelectorAll(selector).length === 1
    } catch {
      return false
    }
  }

  /**
   * Get element's position in parent (for nth-child)
   */
  function getNthChild(element) {
    let index = 1
    let sibling = element.previousElementSibling
    while (sibling) {
      if (sibling.tagName === element.tagName) {
        index++
      }
      sibling = sibling.previousElementSibling
    }
    return index
  }

  /**
   * Check if element is inside shadow DOM
   */
  function isInShadowDom(element) {
    return element.getRootNode() instanceof ShadowRoot
  }

  /**
   * Generate CSS selector for element
   * Priority: id > data-testid > aria-label > role+aria > name > placeholder > unique class > structural
   */
  function generateSelector(element) {
    const tagName = element.tagName.toLowerCase()

    // 1. ID (if unique)
    if (element.id) {
      const selector = `#${cssEscape(element.id)}`
      if (isUniqueSelector(selector)) {
        return selector
      }
    }

    // 2. data-testid, data-cy, data-test, data-qa (testing attributes - most stable)
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'data-qa']) {
      const value = element.getAttribute(attr)
      if (value) {
        const selector = `[${attr}="${cssEscape(value)}"]`
        if (isUniqueSelector(selector)) {
          return selector
        }
      }
    }

    // 3. aria-label (accessibility - usually stable)
    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel) {
      const selector = `${tagName}[aria-label="${cssEscape(ariaLabel)}"]`
      if (isUniqueSelector(selector)) {
        return selector
      }
    }

    // 4. role + aria-label combo
    const role = element.getAttribute('role')
    if (role && ariaLabel) {
      const selector = `[role="${cssEscape(role)}"][aria-label="${cssEscape(ariaLabel)}"]`
      if (isUniqueSelector(selector)) {
        return selector
      }
    }

    // 5. name attribute (for form elements)
    if (element.name) {
      const selector = `${tagName}[name="${cssEscape(element.name)}"]`
      if (isUniqueSelector(selector)) {
        return selector
      }
    }

    // 6. placeholder (for inputs)
    const placeholder = element.getAttribute('placeholder')
    if (placeholder) {
      const selector = `${tagName}[placeholder="${cssEscape(placeholder)}"]`
      if (isUniqueSelector(selector)) {
        return selector
      }
    }

    // 7. Unique class combination
    if (element.classList.length > 0) {
      const classes = Array.from(element.classList)
        .filter(c => !c.match(/^(js-|is-|has-)/)) // Skip state classes
        .slice(0, 3) // Limit to 3 classes
      
      if (classes.length > 0) {
        const selector = `${tagName}.${classes.map(cssEscape).join('.')}`
        if (isUniqueSelector(selector)) {
          return selector
        }
      }
    }

    // 8. Structural selector (fallback)
    return buildStructuralSelector(element)
  }

  /**
   * Build structural selector using parent chain
   */
  function buildStructuralSelector(element) {
    const path = []
    let current = element
    let depth = 0
    const maxDepth = 5

    while (current && current !== document.body && depth < maxDepth) {
      const tagName = current.tagName.toLowerCase()
      let segment = tagName

      // Add nth-of-type if needed
      const parent = current.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          el => el.tagName === current.tagName
        )
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1
          segment = `${tagName}:nth-of-type(${index})`
        }
      }

      path.unshift(segment)
      
      // Check if current path is unique
      const selector = path.join(' > ')
      if (isUniqueSelector(selector)) {
        return selector
      }

      current = current.parentElement
      depth++
    }

    return path.join(' > ')
  }

  /**
   * Check if selector is unique within a given root (document or shadow root)
   */
  function isUniqueSelectorInRoot(selector, root) {
    try {
      return root.querySelectorAll(selector).length === 1
    } catch {
      return false
    }
  }

  /**
   * Generate shadow DOM aware selector (Playwright-style)
   * Validates uniqueness at each shadow boundary
   */
  function generateShadowSelector(element) {
    if (!isInShadowDom(element)) {
      return generateSelector(element)
    }

    const parts = []
    let current = element

    while (current) {
      const root = current.getRootNode()
      
      if (root instanceof ShadowRoot) {
        // Get selector within this shadow root, validate uniqueness in shadow root
        const selector = generateSelector(current)
        if (!isUniqueSelectorInRoot(selector, root)) {
          // Fall back to structural selector within shadow root
          parts.unshift(buildStructuralSelector(current))
        } else {
          parts.unshift(selector)
        }
        current = root.host
      } else {
        // We're in the main document
        parts.unshift(generateSelector(current))
        break
      }
    }

    return parts.join(' >>> ')
  }

  // ==========================================================================
  // OVERLAY UI
  // ==========================================================================

  /**
   * Create overlay UI elements
   */
  function createOverlayUI() {
    // Banner
    const banner = document.createElement('div')
    banner.id = '__oko-picker-banner'
    banner.innerHTML = `
      <span>🎯 Element Picker Active</span>
      <span style="opacity: 0.7; margin-left: 12px;">Click to select | ESC to cancel</span>
    `
    document.body.appendChild(banner)
    overlayElements.banner = banner

    // Highlight box
    const highlight = document.createElement('div')
    highlight.id = '__oko-picker-highlight'
    document.body.appendChild(highlight)
    overlayElements.highlight = highlight

    // Tooltip
    const tooltip = document.createElement('div')
    tooltip.id = '__oko-picker-tooltip'
    document.body.appendChild(tooltip)
    overlayElements.tooltip = tooltip

    // Inject styles
    const style = document.createElement('style')
    style.id = '__oko-picker-styles'
    style.textContent = `
      #__oko-picker-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483647;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        color: #fff;
        padding: 10px 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        display: flex;
        align-items: center;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      }
      #__oko-picker-highlight {
        position: fixed;
        pointer-events: none;
        z-index: 2147483646;
        border: 2px solid #ff6b35;
        background: rgba(255, 107, 53, 0.1);
        border-radius: 3px;
        transition: all 0.05s ease-out;
        display: none;
      }
      #__oko-picker-tooltip {
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        background: #1a1a2e;
        color: #fff;
        padding: 8px 12px;
        border-radius: 4px;
        font-family: 'SF Mono', Monaco, 'Courier New', monospace;
        font-size: 12px;
        max-width: 400px;
        word-break: break-all;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        display: none;
      }
      #__oko-picker-tooltip .selector {
        color: #4ade80;
      }
      #__oko-picker-tooltip .dims {
        color: #94a3b8;
        margin-top: 4px;
        font-size: 11px;
      }
    `
    document.head.appendChild(style)
    overlayElements.style = style
  }

  /**
   * Remove overlay UI elements
   */
  function removeOverlayUI() {
    Object.values(overlayElements).forEach(el => el?.remove())
    overlayElements = {}
  }

  /**
   * Update highlight position
   */
  function updateHighlight(element) {
    if (!element || !overlayElements.highlight) return

    const rect = element.getBoundingClientRect()
    const highlight = overlayElements.highlight

    highlight.style.display = 'block'
    highlight.style.top = `${rect.top}px`
    highlight.style.left = `${rect.left}px`
    highlight.style.width = `${rect.width}px`
    highlight.style.height = `${rect.height}px`
  }

  /**
   * Update tooltip content and position
   */
  function updateTooltip(element, event) {
    if (!element || !overlayElements.tooltip) return

    const tooltip = overlayElements.tooltip
    const selector = generateShadowSelector(element)
    const rect = element.getBoundingClientRect()

    tooltip.innerHTML = `
      <div class="selector">${escapeHtml(selector)}</div>
      <div class="dims">${Math.round(rect.width)} × ${Math.round(rect.height)} px</div>
    `
    tooltip.style.display = 'block'

    // Position tooltip near cursor but not overlapping
    let x = event.clientX + 15
    let y = event.clientY + 15

    // Keep tooltip in viewport
    const tooltipRect = tooltip.getBoundingClientRect()
    if (x + tooltipRect.width > window.innerWidth) {
      x = event.clientX - tooltipRect.width - 15
    }
    if (y + tooltipRect.height > window.innerHeight) {
      y = event.clientY - tooltipRect.height - 15
    }

    tooltip.style.left = `${x}px`
    tooltip.style.top = `${y}px`
  }

  /**
   * Escape HTML for safe display
   */
  function escapeHtml(str) {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  /**
   * Handle mouseover - highlight element
   */
  function onHover(e) {
    // Ignore our own overlay elements
    if (e.target.id?.startsWith('__oko-picker')) return

    highlightedElement = e.target
    updateHighlight(e.target)
    updateTooltip(e.target, e)
  }

  /**
   * Handle click - capture element
   */
  function onClick(e) {
    // Ignore our own overlay elements
    if (e.target.id?.startsWith('__oko-picker')) return

    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    captureElement(e.target)
    deactivatePicker()
  }

  /**
   * Handle keydown - ESC to cancel
   */
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      deactivatePicker()
    }
  }

  // ==========================================================================
  // ELEMENT CAPTURE
  // ==========================================================================

  /**
   * Extract safe attributes from element
   */
  function extractSafeAttributes(element) {
    const attrs = {}

    for (const attr of element.attributes) {
      const name = attr.name.toLowerCase()

      // Skip redacted attributes
      if (REDACTED_ATTRIBUTES.some(r => name === r || name.startsWith(r))) {
        continue
      }

      // Handle URL attributes
      if (URL_ATTRIBUTES.includes(name)) {
        attrs[name] = sanitizeUrlAttribute(attr.value)
        continue
      }

      // Include safe attributes
      if (SAFE_ATTRIBUTES.includes(name)) {
        attrs[name] = attr.value
      }
    }

    return attrs
  }

  /**
   * Scrub text content - remove potential sensitive patterns
   */
  function scrubText(text, maxLength = 100) {
    if (!text) return undefined
    
    let scrubbed = text
      // Remove email-like patterns
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
      // Remove phone-like patterns
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone]')
      // Remove credit card-like patterns
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[card]')
      // Remove SSN-like patterns
      .replace(/\b\d{3}[-]?\d{2}[-]?\d{4}\b/g, '[ssn]')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
    
    // Truncate
    if (scrubbed.length > maxLength) {
      scrubbed = scrubbed.substring(0, maxLength) + '...'
    }
    
    return scrubbed || undefined
  }

  /**
   * Capture element info and send to background
   */
  function captureElement(element) {
    const rect = element.getBoundingClientRect()
    const selector = generateShadowSelector(element)

    const elementInfo = {
      selector,
      tagName: element.tagName.toLowerCase(),
      id: element.id || undefined,
      className: element.className || undefined,
      innerText: scrubText(element.innerText),
      safeAttributes: extractSafeAttributes(element),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      timestamp: Date.now(),
      pageUrl: window.location.origin,
      pageTitle: scrubText(document.title, 200),
      isInShadowDom: isInShadowDom(element)
    }

    // Send to background script
    chrome.runtime.sendMessage({
      type: 'ELEMENT_SELECTED',
      element: elementInfo
    })

    // Visual feedback
    showConfirmation(selector)
  }

  /**
   * Show brief confirmation message
   */
  function showConfirmation(selector) {
    const confirm = document.createElement('div')
    confirm.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #059669;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `
    confirm.textContent = `✓ Selected: ${selector.substring(0, 50)}${selector.length > 50 ? '...' : ''}`
    document.body.appendChild(confirm)

    setTimeout(() => confirm.remove(), 2000)
  }

  // ==========================================================================
  // ACTIVATION / DEACTIVATION
  // ==========================================================================

  /**
   * Activate picker mode
   */
  function activatePicker() {
    createOverlayUI()
    document.addEventListener('mouseover', onHover, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.body.style.cursor = 'crosshair'
  }

  /**
   * Deactivate picker mode
   */
  function deactivatePicker() {
    window.__okoPickerActive = false
    removeOverlayUI()
    document.removeEventListener('mouseover', onHover, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.body.style.cursor = ''
    highlightedElement = null
  }

  // Expose deactivate for re-injection toggle
  window.__okoDeactivatePicker = deactivatePicker

  // ==========================================================================
  // INIT
  // ==========================================================================

  activatePicker()

})()

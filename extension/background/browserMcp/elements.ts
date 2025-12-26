/**
 * Elements Inspection Handler
 * Provides DOM inspection, element info, click, and fill functionality
 */

import { sendToWebSocket } from '../websocket'

// =============================================================================
// TYPES
// =============================================================================

interface ElementInfo {
  tagName: string
  id?: string
  className?: string
  attributes: Record<string, string>
  innerText?: string
  innerHTML?: string
  outerHTML?: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
    top: number
    right: number
    bottom: number
    left: number
  }
  computedStyles?: Record<string, string>
  isVisible: boolean
  childCount: number
}

// =============================================================================
// SCRIPT INJECTION HELPERS
// =============================================================================

/**
 * Execute script with arguments in tab
 */
async function executeInTabWithArgs<T, A extends unknown[]>(
  tabId: number,
  func: (...args: A) => T,
  args: A
): Promise<T> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  })
  
  if (results && results[0]) {
    return results[0].result as T
  }
  throw new Error('Script execution returned no result')
}

// =============================================================================
// ELEMENT INFO SCRIPT
// =============================================================================

/**
 * Script to get element info (runs in page context)
 */
function getElementInfoScript(selector: string, includeStyles: boolean, styleProperties?: string[]): ElementInfo | null {
  const element = document.querySelector(selector)
  if (!element) return null
  
  const rect = element.getBoundingClientRect()
  const htmlElement = element as HTMLElement
  
  // Get attributes
  const attributes: Record<string, string> = {}
  for (const attr of element.attributes) {
    attributes[attr.name] = attr.value
  }
  
  // Check visibility
  const style = window.getComputedStyle(element)
  const isVisible = style.display !== 'none' && 
                    style.visibility !== 'hidden' && 
                    style.opacity !== '0' &&
                    rect.width > 0 && 
                    rect.height > 0
  
  // Get computed styles if requested
  let computedStyles: Record<string, string> | undefined
  if (includeStyles) {
    const defaultProps = [
      'display', 'position', 'width', 'height', 'margin', 'padding',
      'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight',
      'border', 'borderRadius', 'boxShadow', 'opacity', 'zIndex',
      'flexDirection', 'justifyContent', 'alignItems', 'gap'
    ]
    const props = styleProperties || defaultProps
    computedStyles = {}
    for (const prop of props) {
      computedStyles[prop] = style.getPropertyValue(prop) || style[prop as keyof CSSStyleDeclaration] as string || ''
    }
  }
  
  // Limit innerHTML/outerHTML size
  const maxHtmlLength = 5000
  let innerHTML = htmlElement.innerHTML
  let outerHTML = htmlElement.outerHTML
  if (innerHTML.length > maxHtmlLength) {
    innerHTML = innerHTML.substring(0, maxHtmlLength) + '... [truncated]'
  }
  if (outerHTML.length > maxHtmlLength) {
    outerHTML = outerHTML.substring(0, maxHtmlLength) + '... [truncated]'
  }
  
  // Limit innerText
  let innerText = htmlElement.innerText || ''
  if (innerText.length > 1000) {
    innerText = innerText.substring(0, 1000) + '... [truncated]'
  }
  
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    className: element.className || undefined,
    attributes,
    innerText,
    innerHTML,
    outerHTML,
    bounds: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    },
    computedStyles,
    isVisible,
    childCount: element.children.length
  }
}

// =============================================================================
// CLICK SCRIPT
// =============================================================================

/**
 * Script to click an element (runs in page context)
 */
function clickElementScript(selector: string): { success: boolean; error?: string } {
  const element = document.querySelector(selector) as HTMLElement
  if (!element) {
    return { success: false, error: `Element not found: ${selector}` }
  }
  
  // Check if element is visible and clickable
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  
  if (style.display === 'none' || style.visibility === 'hidden') {
    return { success: false, error: 'Element is not visible' }
  }
  
  if (rect.width === 0 || rect.height === 0) {
    return { success: false, error: 'Element has no dimensions' }
  }
  
  // Scroll into view if needed
  element.scrollIntoView({ behavior: 'instant', block: 'center' })
  
  // Dispatch click event
  element.click()
  
  return { success: true }
}

// =============================================================================
// FILL SCRIPT
// =============================================================================

/**
 * Script to fill an input element (runs in page context)
 */
function fillInputScript(selector: string, value: string): { success: boolean; error?: string } {
  const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
  if (!element) {
    return { success: false, error: `Element not found: ${selector}` }
  }
  
  // Check if element is an input or textarea
  const tagName = element.tagName.toLowerCase()
  if (tagName !== 'input' && tagName !== 'textarea' && !element.isContentEditable) {
    return { success: false, error: `Element is not fillable: ${tagName}` }
  }
  
  // Focus the element
  element.focus()
  
  // Set value
  if (element.isContentEditable) {
    element.textContent = value
  } else {
    element.value = value
  }
  
  // Dispatch input and change events for React/Vue/etc
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  
  return { success: true }
}

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

interface GetElementInfoMessage {
  requestId: string
  tabId?: number
  selector: string
  includeStyles?: boolean
  styleProperties?: string[]
}

interface ClickElementMessage {
  requestId: string
  tabId?: number
  selector: string
}

interface FillInputMessage {
  requestId: string
  tabId?: number
  selector: string
  value: string
}

/**
 * Get the target tab ID (active tab if not specified)
 */
async function getTargetTabId(tabId?: number): Promise<number> {
  if (tabId !== undefined) {
    return tabId
  }
  
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!activeTab?.id) {
    throw new Error('No active tab found')
  }
  return activeTab.id
}

/**
 * Handle get element info request
 */
export async function handleGetElementInfo(message: GetElementInfoMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    
    const elementInfo = await executeInTabWithArgs(
      tabId,
      getElementInfoScript,
      [message.selector, message.includeStyles ?? true, message.styleProperties]
    )
    
    if (!elementInfo) {
      sendToWebSocket({
        type: 'browser-get-element-info-result',
        requestId: message.requestId,
        success: false,
        error: `Element not found: ${message.selector}`
      })
      return
    }
    
    sendToWebSocket({
      type: 'browser-get-element-info-result',
      requestId: message.requestId,
      success: true,
      element: elementInfo
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-get-element-info-result',
      requestId: message.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Handle click element request
 */
export async function handleClickElement(message: ClickElementMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    
    const result = await executeInTabWithArgs(
      tabId,
      clickElementScript,
      [message.selector]
    )
    
    sendToWebSocket({
      type: 'browser-click-element-result',
      requestId: message.requestId,
      success: result.success,
      error: result.error
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-click-element-result',
      requestId: message.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Handle fill input request
 */
export async function handleFillInput(message: FillInputMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    
    const result = await executeInTabWithArgs(
      tabId,
      fillInputScript,
      [message.selector, message.value]
    )
    
    sendToWebSocket({
      type: 'browser-fill-input-result',
      requestId: message.requestId,
      success: result.success,
      error: result.error
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-fill-input-result',
      requestId: message.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Handle highlight element request (optional visual feedback)
 */
export async function handleHighlightElement(message: { requestId: string; tabId?: number; selector: string; duration?: number }): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    const duration = message.duration || 2000
    
    await executeInTabWithArgs(
      tabId,
      (selector: string, durationMs: number) => {
        const element = document.querySelector(selector) as HTMLElement
        if (!element) return false
        
        const originalOutline = element.style.outline
        const originalOutlineOffset = element.style.outlineOffset
        
        element.style.outline = '3px solid #ff6b35'
        element.style.outlineOffset = '2px'
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        
        setTimeout(() => {
          element.style.outline = originalOutline
          element.style.outlineOffset = originalOutlineOffset
        }, durationMs)
        
        return true
      },
      [message.selector, duration]
    )
    
    sendToWebSocket({
      type: 'browser-highlight-element-result',
      requestId: message.requestId,
      success: true
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-highlight-element-result',
      requestId: message.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Elements Inspection Handler
 * Provides DOM inspection and interaction primitives for browser automation.
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

interface InteractionResult {
  success: boolean
  error?: string
}

interface WaitResult extends InteractionResult {
  matched: boolean
  elapsedMs: number
}

interface AssertResult extends InteractionResult {
  passed: boolean
  details: Record<string, unknown>
}

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
  mode?: 'human' | 'native'
}

interface FillInputMessage {
  requestId: string
  tabId?: number
  selector: string
  value: string
}

interface HoverElementMessage {
  requestId: string
  tabId?: number
  selector: string
}

interface TypeInputMessage {
  requestId: string
  tabId?: number
  selector: string
  text: string
  clear?: boolean
  delayMs?: number
}

interface PressKeyMessage {
  requestId: string
  tabId?: number
  key: string
  modifiers?: string[]
}

interface ScrollMessage {
  requestId: string
  tabId?: number
  selector?: string
  deltaX?: number
  deltaY?: number
  to?: 'top' | 'bottom'
  behavior?: 'auto' | 'smooth'
}

interface WaitMessage {
  requestId: string
  tabId?: number
  condition: 'element' | 'url'
  selector?: string
  state?: 'present' | 'visible' | 'hidden'
  urlIncludes?: string
  timeoutMs?: number
  pollMs?: number
}

interface AssertMessage {
  requestId: string
  tabId?: number
  selector?: string
  visible?: boolean
  enabled?: boolean
  textContains?: string
  valueEquals?: string
  urlIncludes?: string
}

// =============================================================================
// SCRIPT INJECTION HELPERS
// =============================================================================

async function executeInTabWithArgs<T, A extends unknown[]>(
  tabId: number,
  func: (...args: A) => T | Promise<T>,
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

// =============================================================================
// PAGE CONTEXT SCRIPTS
// =============================================================================

function getElementInfoScript(selector: string, includeStyles: boolean, styleProperties: string[] | null): ElementInfo | null {
  const element = document.querySelector(selector)
  if (!element) return null

  const rect = element.getBoundingClientRect()
  const htmlElement = element as HTMLElement

  const attributes: Record<string, string> = {}
  for (const attr of element.attributes) {
    attributes[attr.name] = attr.value
  }

  const style = window.getComputedStyle(element)
  const isVisible = style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    rect.width > 0 &&
    rect.height > 0

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

  const maxHtmlLength = 5000
  let innerHTML = htmlElement.innerHTML
  let outerHTML = htmlElement.outerHTML
  if (innerHTML.length > maxHtmlLength) {
    innerHTML = innerHTML.substring(0, maxHtmlLength) + '... [truncated]'
  }
  if (outerHTML.length > maxHtmlLength) {
    outerHTML = outerHTML.substring(0, maxHtmlLength) + '... [truncated]'
  }

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

function clickElementScript(selector: string, mode: 'human' | 'native' = 'human'): InteractionResult {
  const element = document.querySelector(selector) as HTMLElement | null
  if (!element) {
    return { success: false, error: `Element not found: ${selector}` }
  }

  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
    return { success: false, error: 'Element is not interactable' }
  }
  if (rect.width <= 0 || rect.height <= 0) {
    return { success: false, error: 'Element has no dimensions' }
  }

  element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' })

  const liveRect = element.getBoundingClientRect()
  const centerX = liveRect.left + liveRect.width / 2
  const centerY = liveRect.top + liveRect.height / 2
  const fromPoint = document.elementFromPoint(centerX, centerY) as HTMLElement | null
  const target = fromPoint &&
    (fromPoint === element || element.contains(fromPoint) || fromPoint.contains(element))
    ? fromPoint
    : element

  if (target instanceof HTMLElement) {
    target.focus({ preventScroll: true })
  }

  if (mode === 'human') {
    const downMouse: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
      button: 0,
      buttons: 1,
    }
    const upMouse: MouseEventInit = {
      ...downMouse,
      buttons: 0,
    }

    if (typeof PointerEvent === 'function') {
      target.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 0,
        buttons: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }))
    }
    target.dispatchEvent(new MouseEvent('mousedown', downMouse))

    if (typeof PointerEvent === 'function') {
      target.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 0,
        buttons: 0,
        pointerType: 'mouse',
        isPrimary: true,
      }))
    }
    target.dispatchEvent(new MouseEvent('mouseup', upMouse))
  }

  element.click()
  return { success: true }
}

function fillInputScript(selector: string, value: string): InteractionResult {
  const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
  if (!element) {
    return { success: false, error: `Element not found: ${selector}` }
  }

  const tagName = element.tagName.toLowerCase()
  if (tagName !== 'input' && tagName !== 'textarea' && !element.isContentEditable) {
    return { success: false, error: `Element is not fillable: ${tagName}` }
  }

  element.focus()

  if (element.isContentEditable) {
    element.textContent = value
  } else {
    const inputElement = element as HTMLInputElement | HTMLTextAreaElement
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inputElement), 'value')
    if (descriptor && descriptor.set) {
      descriptor.set.call(inputElement, value)
    } else {
      inputElement.value = value
    }
  }

  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))

  return { success: true }
}

function hoverElementScript(selector: string): InteractionResult {
  const element = document.querySelector(selector) as HTMLElement | null
  if (!element) {
    return { success: false, error: `Element not found: ${selector}` }
  }

  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return { success: false, error: 'Element is not visible' }
  }
  if (rect.width <= 0 || rect.height <= 0) {
    return { success: false, error: 'Element has no dimensions' }
  }

  element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' })
  const liveRect = element.getBoundingClientRect()
  const centerX = liveRect.left + liveRect.width / 2
  const centerY = liveRect.top + liveRect.height / 2
  const target = (document.elementFromPoint(centerX, centerY) as HTMLElement | null) || element

  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: centerX,
    clientY: centerY,
    relatedTarget: null,
  }

  target.dispatchEvent(new MouseEvent('mousemove', mouseInit))
  target.dispatchEvent(new MouseEvent('mouseover', mouseInit))
  target.dispatchEvent(new MouseEvent('mouseenter', { ...mouseInit, bubbles: false }))

  return { success: true }
}

async function typeInputScript(selector: string, text: string, clear: boolean, delayMs: number): Promise<InteractionResult> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
  if (!element) {
    return { success: false, error: `Element not found: ${selector}` }
  }

  const isInput = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
  const isEditable = isInput || element.isContentEditable
  if (!isEditable) {
    return { success: false, error: 'Element is not typeable' }
  }

  const setEditableValue = (target: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')
    if (descriptor && descriptor.set) {
      descriptor.set.call(target, value)
    } else {
      target.value = value
    }
  }

  const appendChar = (char: string) => {
    if (isInput) {
      const input = element as HTMLInputElement | HTMLTextAreaElement
      const next = `${input.value}${char}`
      setEditableValue(input, next)
    } else {
      element.textContent = `${element.textContent || ''}${char}`
    }
  }

  const clearValue = () => {
    if (isInput) {
      const input = element as HTMLInputElement | HTMLTextAreaElement
      setEditableValue(input, '')
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(0, 0)
      }
    } else {
      element.textContent = ''
    }
  }

  element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' })
  element.focus({ preventScroll: true })

  if (clear) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true, cancelable: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', ctrlKey: true, bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    clearValue()
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', bubbles: true }))
  }

  for (const char of text) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }))

    if (typeof InputEvent === 'function') {
      try {
        element.dispatchEvent(new InputEvent('beforeinput', {
          data: char,
          inputType: 'insertText',
          bubbles: true,
          cancelable: true,
        }))
      } catch {
        element.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }))
      }
    }

    appendChar(char)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))

    if (delayMs > 0) {
      await sleep(delayMs)
    }
  }

  element.dispatchEvent(new Event('change', { bubbles: true }))
  return { success: true }
}

function pressKeyScript(key: string, modifiers: string[]): InteractionResult {
  const modifierSet = new Set(modifiers.map((value) => value.toLowerCase()))
  const eventInit: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifierSet.has('ctrl') || modifierSet.has('control'),
    altKey: modifierSet.has('alt'),
    shiftKey: modifierSet.has('shift'),
    metaKey: modifierSet.has('meta') || modifierSet.has('cmd') || modifierSet.has('command'),
  }

  const target = (document.activeElement as HTMLElement | null) || document.body
  if (!target) {
    return { success: false, error: 'No active target for key press' }
  }

  target.dispatchEvent(new KeyboardEvent('keydown', eventInit))
  target.dispatchEvent(new KeyboardEvent('keyup', eventInit))
  return { success: true }
}

async function scrollScript(
  selector: string | undefined,
  deltaX: number | undefined,
  deltaY: number | undefined,
  to: 'top' | 'bottom' | undefined,
  behavior: 'auto' | 'smooth'
): Promise<InteractionResult> {
  const sleepFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

  const element = selector ? document.querySelector(selector) as HTMLElement | null : null
  if (selector && !element) {
    return { success: false, error: `Element not found: ${selector}` }
  }

  const usingWindow = !element
  const readPosition = () => {
    if (usingWindow) {
      return { x: window.scrollX, y: window.scrollY }
    }
    return { x: element!.scrollLeft, y: element!.scrollTop }
  }

  const writeScrollTo = (x: number, y: number) => {
    if (usingWindow) {
      window.scrollTo({ left: x, top: y, behavior })
      return
    }
    element!.scrollTo({ left: x, top: y, behavior })
  }

  const writeScrollBy = (x: number, y: number) => {
    if (usingWindow) {
      window.scrollBy({ left: x, top: y, behavior })
      return
    }
    element!.scrollBy({ left: x, top: y, behavior })
  }

  if (to) {
    const targetY = to === 'top'
      ? 0
      : (usingWindow
        ? Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight
        : Math.max(element!.scrollHeight - element!.clientHeight, 0))
    const current = readPosition()
    writeScrollTo(current.x, targetY)
  } else {
    writeScrollBy(deltaX || 0, deltaY || 0)
  }

  if (behavior === 'smooth') {
    let stableTicks = 0
    let previous = readPosition()
    const start = Date.now()
    while (Date.now() - start < 2000) {
      await sleepFrame()
      const current = readPosition()
      const delta = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)
      if (delta < 0.5) {
        stableTicks += 1
      } else {
        stableTicks = 0
      }
      previous = current
      if (stableTicks >= 4) {
        break
      }
    }
  }

  return { success: true }
}

async function waitScript(
  condition: 'element' | 'url',
  selector: string | undefined,
  state: 'present' | 'visible' | 'hidden',
  urlIncludes: string | undefined,
  timeoutMs: number,
  pollMs: number
): Promise<WaitResult> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const start = Date.now()

  const isVisible = (element: Element) => {
    const rect = element.getBoundingClientRect()
    const computed = window.getComputedStyle(element)
    return computed.display !== 'none' && computed.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }

  const matches = () => {
    if (condition === 'url') {
      return typeof urlIncludes === 'string' ? window.location.href.includes(urlIncludes) : false
    }

    if (!selector) {
      return false
    }

    const element = document.querySelector(selector)
    if (state === 'present') return Boolean(element)
    if (state === 'hidden') return !element || !isVisible(element)
    return Boolean(element && isVisible(element))
  }

  while (Date.now() - start <= timeoutMs) {
    if (matches()) {
      return { success: true, matched: true, elapsedMs: Date.now() - start }
    }
    await sleep(pollMs)
  }

  return {
    success: true,
    matched: false,
    elapsedMs: Date.now() - start,
    error: `Condition not met within ${timeoutMs}ms`
  }
}

function assertScript(args: {
  selector?: string
  visible?: boolean
  enabled?: boolean
  textContains?: string
  valueEquals?: string
  urlIncludes?: string
}): AssertResult {
  const details: Record<string, unknown> = {}
  let passed = true

  const element = args.selector ? document.querySelector(args.selector) as HTMLElement | null : null
  if (args.selector) {
    details.selector = args.selector
    details.elementFound = Boolean(element)
    if (!element) {
      passed = false
    }
  }

  const isVisible = (target: Element | null) => {
    if (!target) return false
    const rect = target.getBoundingClientRect()
    const computed = window.getComputedStyle(target)
    return computed.display !== 'none' && computed.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }

  if (args.visible !== undefined) {
    const actual = isVisible(element)
    details.visible = { expected: args.visible, actual }
    if (actual !== args.visible) {
      passed = false
    }
  }

  if (args.enabled !== undefined) {
    let actual = false
    if (element) {
      const attrDisabled = element.getAttribute('aria-disabled') === 'true'
      const asControl = element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
      actual = !attrDisabled && !Boolean(asControl.disabled)
    }
    details.enabled = { expected: args.enabled, actual }
    if (actual !== args.enabled) {
      passed = false
    }
  }

  if (args.textContains !== undefined) {
    const source = element ? (element.innerText || element.textContent || '') : (document.body?.innerText || '')
    const actual = source.includes(args.textContains)
    details.textContains = { expected: args.textContains, actual }
    if (!actual) {
      passed = false
    }
  }

  if (args.valueEquals !== undefined) {
    let actualValue = ''
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      actualValue = element.value
    } else if (element?.isContentEditable) {
      actualValue = element.textContent || ''
    }
    details.valueEquals = { expected: args.valueEquals, actual: actualValue }
    if (actualValue !== args.valueEquals) {
      passed = false
    }
  }

  if (args.urlIncludes !== undefined) {
    const actual = window.location.href.includes(args.urlIncludes)
    details.urlIncludes = { expected: args.urlIncludes, actual, url: window.location.href }
    if (!actual) {
      passed = false
    }
  }

  return {
    success: true,
    passed,
    details,
  }
}

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

export async function handleGetElementInfo(message: GetElementInfoMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)

    const elementInfo = await executeInTabWithArgs(
      tabId,
      getElementInfoScript,
      [message.selector, message.includeStyles ?? true, message.styleProperties ?? null]
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

export async function handleClickElement(message: ClickElementMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)

    const result = await executeInTabWithArgs(
      tabId,
      clickElementScript,
      [message.selector, message.mode || 'human']
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

export async function handleHoverElement(message: HoverElementMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    const result = await executeInTabWithArgs(tabId, hoverElementScript, [message.selector])

    sendToWebSocket({
      type: 'browser-hover-element-result',
      requestId: message.requestId,
      success: result.success,
      error: result.error
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-hover-element-result',
      requestId: message.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export async function handleTypeInput(message: TypeInputMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    const result = await executeInTabWithArgs(
      tabId,
      typeInputScript,
      [message.selector, message.text, message.clear === true, Math.max(0, message.delayMs ?? 35)]
    )

    sendToWebSocket({
      type: 'browser-type-input-result',
      requestId: message.requestId,
      success: result.success,
      error: result.error
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-type-input-result',
      requestId: message.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export async function handlePressKey(message: PressKeyMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    const modifiers = Array.isArray(message.modifiers) ? message.modifiers : []
    const result = await executeInTabWithArgs(tabId, pressKeyScript, [message.key, modifiers])

    sendToWebSocket({
      type: 'browser-press-key-result',
      requestId: message.requestId,
      success: result.success,
      error: result.error
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-press-key-result',
      requestId: message.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export async function handleScroll(message: ScrollMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    const result = await executeInTabWithArgs(
      tabId,
      scrollScript,
      [
        message.selector,
        message.deltaX,
        message.deltaY,
        message.to,
        message.behavior || 'auto'
      ]
    )

    sendToWebSocket({
      type: 'browser-scroll-result',
      requestId: message.requestId,
      success: result.success,
      error: result.error
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-scroll-result',
      requestId: message.requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export async function handleWait(message: WaitMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    const result = await executeInTabWithArgs(
      tabId,
      waitScript,
      [
        message.condition,
        message.selector,
        message.state || 'visible',
        message.urlIncludes,
        message.timeoutMs ?? 5000,
        message.pollMs ?? 100,
      ]
    )

    sendToWebSocket({
      type: 'browser-wait-result',
      requestId: message.requestId,
      success: result.success,
      matched: result.matched,
      elapsedMs: result.elapsedMs,
      error: result.error
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-wait-result',
      requestId: message.requestId,
      success: false,
      matched: false,
      elapsedMs: 0,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export async function handleAssert(message: AssertMessage): Promise<void> {
  try {
    const tabId = await getTargetTabId(message.tabId)
    const result = await executeInTabWithArgs(tabId, assertScript, [{
      selector: message.selector,
      visible: message.visible,
      enabled: message.enabled,
      textContains: message.textContains,
      valueEquals: message.valueEquals,
      urlIncludes: message.urlIncludes,
    }])

    sendToWebSocket({
      type: 'browser-assert-result',
      requestId: message.requestId,
      success: result.success,
      passed: result.passed,
      details: result.details,
      error: result.error
    })
  } catch (err) {
    sendToWebSocket({
      type: 'browser-assert-result',
      requestId: message.requestId,
      success: false,
      passed: false,
      details: {},
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

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

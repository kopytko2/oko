import { parseConnectionCode as parseSharedConnectionCode } from '../shared/dist/connectionCode.js'

export function parseConnectionCode(value) {
  if (typeof value !== 'string') return null
  return parseSharedConnectionCode(value)
}

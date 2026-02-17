#!/usr/bin/env node

import { pathToFileURL } from 'url'
import { extractGlobalOptions, getHelpText, parseCommand } from './argparse.js'
import { resolveRuntimeConfig } from './config.js'
import { createApiClient } from './client.js'
import { toErrorEnvelope, writeData, writeError } from './format.js'
import { runDoctor } from './commands/doctor.js'
import { runTabsList } from './commands/tabs.js'
import { runCaptureApi } from './commands/capture.js'
import {
  runAssert,
  runClick,
  runFill,
  runHover,
  runKey,
  runScreenshot,
  runScroll,
  runType,
  runWait,
} from './commands/browser.js'
import { runApiCall } from './commands/api.js'
import { runTestScenario } from './commands/test.js'

export async function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin }) {
  try {
    const { globalOptions, commandArgs } = extractGlobalOptions(argv)
    const parsed = parseCommand(commandArgs)

    if (globalOptions.help || parsed.key === 'help') {
      io.stdout.write(`${getHelpText()}\n`)
      return 0
    }

    const config = resolveRuntimeConfig(globalOptions, process.env)
    const client = createApiClient(config)

    let data
    switch (parsed.key) {
      case 'doctor': {
        data = await runDoctor({ client, config })
        break
      }
      case 'tabs.list': {
        data = await runTabsList({ client })
        break
      }
      case 'capture.api': {
        data = await runCaptureApi({ client, options: parsed.options, output: config.output, io })
        break
      }
      case 'browser.screenshot': {
        data = await runScreenshot({ client, options: parsed.options })
        break
      }
      case 'browser.click': {
        data = await runClick({ client, options: parsed.options })
        break
      }
      case 'browser.fill': {
        data = await runFill({ client, options: parsed.options })
        break
      }
      case 'browser.hover': {
        data = await runHover({ client, options: parsed.options })
        break
      }
      case 'browser.type': {
        data = await runType({ client, options: parsed.options })
        break
      }
      case 'browser.key': {
        data = await runKey({ client, options: parsed.options })
        break
      }
      case 'browser.scroll': {
        data = await runScroll({ client, options: parsed.options })
        break
      }
      case 'browser.wait': {
        data = await runWait({ client, options: parsed.options })
        break
      }
      case 'browser.assert': {
        data = await runAssert({ client, options: parsed.options })
        break
      }
      case 'test.run': {
        data = await runTestScenario({ client, options: parsed.options })
        break
      }
      case 'api.get': {
        data = await runApiCall({ client, method: 'get', options: parsed.options })
        break
      }
      case 'api.post': {
        data = await runApiCall({ client, method: 'post', options: parsed.options })
        break
      }
      case 'api.delete': {
        data = await runApiCall({ client, method: 'delete', options: parsed.options })
        break
      }
      default:
        throw new Error(`Unhandled command: ${parsed.key}`)
    }

    if (!data?._skipOutput) {
      writeData(data, config.output, parsed.key, io.stdout)
    }

    if (parsed.key === 'doctor') {
      return data.success ? 0 : 1
    }

    if (data && typeof data.success === 'boolean') {
      return data.success ? 0 : 1
    }

    return 0
  } catch (err) {
    const globalOutput = (() => {
      try {
        const { globalOptions } = extractGlobalOptions(argv)
        return globalOptions.output || 'json'
      } catch {
        return 'json'
      }
    })()

    const envelope = toErrorEnvelope(err)
    writeError(envelope, globalOutput, io.stderr)
    return envelope.exitCode || 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().then((code) => {
    process.exitCode = code
  })
}

import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { loadScenario } from '../commands/test.js'

async function withTempScenario(contents, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oko-scenario-validate-'))
  const file = path.join(dir, 'scenario.yaml')
  await fs.writeFile(file, contents, 'utf8')
  try {
    await fn(file)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('scenario validation', () => {
  it('rejects unsupported step types', async () => {
    const yaml = `version: 1\nsteps:\n  - unknown: { foo: bar }\n`

    await withTempScenario(yaml, async (file) => {
      await expect(loadScenario(file, true)).rejects.toThrow(/unsupported step type/i)
    })
  })

  it('rejects extra keys in strict mode', async () => {
    const yaml = `version: 1\nsteps:\n  - click: { selector: "button", random: true }\n`

    await withTempScenario(yaml, async (file) => {
      await expect(loadScenario(file, true)).rejects.toThrow(/unsupported key/i)
    })
  })
})

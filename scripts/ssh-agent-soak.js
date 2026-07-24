import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveAgentSoakConfiguration } from './agent-soak-config.js'
import { AgentSoakRunner } from './agent-soak-runner.js'

export { resolveAgentSoakConfiguration, summarizeAgentSoakValues } from './agent-soak-config.js'

/** @returns {Promise<void>} */
async function main() {
  const runner = new AgentSoakRunner(resolveAgentSoakConfiguration(process.env))

  await runner.run()
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''

if (import.meta.url === invokedPath) {
  try {
    await main()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

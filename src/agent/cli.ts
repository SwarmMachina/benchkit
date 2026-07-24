#!/usr/bin/env node

import { once } from 'node:events'
import { encodeNdjson } from '../control/ndjson.js'
import { serializeError } from '../control/errors.js'
import { PROTOCOL_VERSION } from '../control/version.js'
import type { ControlEvent, ControlResponse } from '../control/protocol.js'
import { AgentStdioRuntime } from './agent-stdio-runtime.js'
import { decodeAgentConfiguration } from './config.js'

function getConfigurationArgument(argv: string[]): string {
  const stdioIndex = argv.indexOf('--stdio')
  const configIndex = argv.indexOf('--config-base64')

  if (stdioIndex === -1 || configIndex === -1 || configIndex + 1 >= argv.length) {
    throw new Error('Usage: benchkit-agent --stdio --config-base64 <config>')
  }

  return argv[configIndex + 1] as string
}

async function main(): Promise<void> {
  const encoded = getConfigurationArgument(process.argv.slice(2))
  const config = decodeAgentConfiguration(encoded)
  const runtime = new AgentStdioRuntime(config)

  await runtime.start()
}

async function writeFatalError(error: unknown): Promise<void> {
  const message: ControlResponse | ControlEvent = {
    version: PROTOCOL_VERSION,
    id: null,
    type: 'agent:error',
    status: 'error',
    error: serializeError(error)
  }

  try {
    if (!process.stdout.write(encodeNdjson(message))) {
      await once(process.stdout, 'drain')
    }
  } catch {
    // The control stream may be the source of the startup failure.
  }
}

try {
  await main()
} catch (error) {
  await writeFatalError(error)
  process.exitCode = 1
}

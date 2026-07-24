#!/usr/bin/env node

import { once } from 'node:events'
import { NdjsonDecoder, encodeNdjson } from '../control/ndjson.js'
import { serializeError } from '../control/errors.js'
import { PROTOCOL_VERSION } from '../control/version.js'
import type { ControlEvent, ControlResponse } from '../control/protocol.js'
import { BenchkitAgent } from './agent.js'
import { decodeAgentConfiguration } from './config.js'

function getConfigurationArgument(argv: string[]): string {
  const stdioIndex = argv.indexOf('--stdio')
  const configIndex = argv.indexOf('--config-base64')

  if (stdioIndex === -1 || configIndex === -1 || configIndex + 1 >= argv.length) {
    throw new Error('Usage: benchkit-agent --stdio --config-base64 <config>')
  }

  return argv[configIndex + 1] as string
}

let writeQueue = Promise.resolve()

function write(message: ControlResponse | ControlEvent): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    if (!process.stdout.write(encodeNdjson(message))) {
      await once(process.stdout, 'drain')
    }

    return undefined
  })

  return writeQueue
}

async function main(): Promise<void> {
  const encoded = getConfigurationArgument(process.argv.slice(2))
  const config = decodeAgentConfiguration(encoded)
  const agent = new BenchkitAgent(config, write)

  let commandQueue = Promise.resolve()
  let fatal = false

  const fail = async (error: unknown) => {
    if (fatal) {
      return
    }

    fatal = true
    // The fatal callback must flush its control error before target cleanup.
    // eslint-disable-next-line promise/no-promise-in-callback
    await write({
      version: PROTOCOL_VERSION,
      id: null,
      type: 'agent:error',
      status: 'error',
      error: serializeError(error)
    }).catch(() => {})
    await agent.close()
    process.exit(1)
  }
  const decoder = new NdjsonDecoder({
    onMessage(message) {
      enqueue(message)
    },
    onError(error) {
      void fail(error)
    }
  })
  const enqueue = (message: unknown) => {
    commandQueue = commandQueue.then(() => agent.handle(message)).catch(fail)
  }
  const close = async () => {
    decoder.end()
    await commandQueue.catch(() => {})
    await agent.close()
  }

  process.stdin.on('data', (chunk: Buffer) => decoder.push(chunk))
  process.stdin.once('end', () => {
    void close()
  })
  process.stdin.once('error', (error) => {
    void fail(error)
  })
  process.stdout.once('error', () => {
    void agent.close().finally(() => process.exit(1))
  })
  process.stderr.on('error', () => {
    // A disconnected runner may close diagnostics before stdin propagation.
  })
  process.once('uncaughtException', (error) => {
    void fail(error)
  })
  process.once('unhandledRejection', (error) => {
    void fail(error)
  })
  process.once('SIGTERM', () => {
    void close().finally(() => process.exit(0))
  })
  process.once('SIGINT', () => {
    void close().finally(() => process.exit(0))
  })

  await agent.announce()
  process.stdin.resume()
}

try {
  await main()
} catch (error) {
  await write({
    version: PROTOCOL_VERSION,
    id: null,
    type: 'agent:error',
    status: 'error',
    error: serializeError(error)
  }).catch(() => {})
  process.exitCode = 1
}

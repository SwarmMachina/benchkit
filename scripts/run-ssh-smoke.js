import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveSshSmokeConfiguration } from './ssh-smoke-config.js'
import { SshSmokeRun } from './ssh-smoke-run.js'

export { parseSupportedNodeVersion, resolveSshSmokeConfiguration } from './ssh-smoke-config.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @returns {void} */
function main() {
  const soak = process.argv.includes('--soak')
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--soak')

  if (unknownArguments.length > 0) {
    throw new Error(`unknown SSH smoke arguments: ${unknownArguments.join(', ')}`)
  }

  const run = new SshSmokeRun({
    root,
    configuration: resolveSshSmokeConfiguration(process.env),
    soak
  })

  run.run()
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''

if (import.meta.url === invokedPath) {
  try {
    main()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}

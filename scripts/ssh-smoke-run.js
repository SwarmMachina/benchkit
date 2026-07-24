import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSupportedNodeVersion } from './ssh-smoke-config.js'

const maxArchiveBytes = 16 * 1024 * 1024

export class SshSmokeRun {
  #root
  #configuration
  #soak
  #temporaryDirectory
  #archive
  #failure
  #remoteTouched = false

  /**
   * @param {{
   *   root: string,
   *   configuration: ReturnType<import('./ssh-smoke-config.js').resolveSshSmokeConfiguration>,
   *   soak: boolean
   * }} options
   */
  constructor({ root, configuration, soak }) {
    this.#root = root
    this.#configuration = configuration
    this.#soak = soak
  }

  /** @returns {void} */
  run() {
    try {
      this.#execute()
    } catch (error) {
      this.#failure = error
    } finally {
      this.#cleanupLocal()
      this.#cleanupRemote()
    }

    if (this.#failure) {
      throw this.#failure
    }
  }

  /** @returns {void} */
  #execute() {
    this.#temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'benchkit-ssh-smoke-'))
    this.#archive = path.join(this.#temporaryDirectory, 'worktree.tgz')

    const preflight = runCommand('ssh', sshArguments(this.#configuration.destination, 'node --version'), {
      label: 'SSH preflight',
      timeout: 15_000,
      encoding: 'utf8'
    })
    const remoteNodeMajor = parseSupportedNodeVersion(preflight.stdout)

    console.log(`SSH smoke: ${this.#configuration.destination} uses Node.js ${remoteNodeMajor}`)

    const tarArguments = [
      ...(process.platform === 'darwin' ? ['--no-xattrs'] : []),
      '-czf',
      this.#archive,
      '--',
      'package.json',
      'dist',
      'tests/fixtures/target/target.mjs'
    ]

    runCommand('tar', tarArguments, {
      cwd: this.#root,
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      label: 'local smoke archive',
      timeout: 30_000,
      stdio: 'inherit'
    })

    const archiveBytes = fs.statSync(this.#archive).size

    if (archiveBytes > maxArchiveBytes) {
      throw new Error(`SSH smoke archive exceeds ${maxArchiveBytes} bytes`)
    }

    const remoteDirectory = this.#configuration.remoteDirectory
    const prepare = [
      'set -eu',
      'umask 077',
      `mkdir -p ${remoteDirectory}`,
      `tar -xzf - -C ${remoteDirectory}`,
      `mkdir -p ${remoteDirectory}/node_modules/.bin`,
      `chmod +x ${remoteDirectory}/dist/agent/cli.js`,
      `ln -s ../../dist/agent/cli.js ${remoteDirectory}/node_modules/.bin/benchkit-agent`
    ].join(' && ')

    this.#remoteTouched = true
    runCommand('ssh', sshArguments(this.#configuration.destination, prepare), {
      label: 'remote smoke staging',
      timeout: 30_000,
      input: fs.readFileSync(this.#archive),
      stdio: ['pipe', 'inherit', 'inherit']
    })

    console.log(
      `SSH smoke: staged ${archiveBytes} bytes at ` +
        `${this.#configuration.destination}:${this.#configuration.remoteDirectory}`
    )

    const runnerArguments = this.#soak
      ? [fileURLToPath(new URL('./ssh-agent-soak.js', import.meta.url))]
      : [
          '--experimental-strip-types',
          '--test',
          '--test-concurrency=1',
          '--test-name-pattern=^real SSH transport lifecycle$',
          fileURLToPath(new URL('../tests/integration/target/target-provider.test.ts', import.meta.url))
        ]

    runCommand(process.execPath, runnerArguments, {
      label: this.#soak ? 'SSH agent surface soak' : 'real SSH transport lifecycle',
      timeout: this.#soak ? 300_000 : 120_000,
      env: {
        ...process.env,
        BENCHKIT_SSH_CWD: this.#configuration.remoteDirectory,
        BENCHKIT_SSH_CONNECT_HOST: this.#configuration.connectHost
      },
      stdio: 'inherit'
    })
  }

  /** @returns {void} */
  #cleanupLocal() {
    if (!this.#temporaryDirectory) {
      return
    }

    try {
      fs.rmSync(this.#temporaryDirectory, { recursive: true, force: true })
    } catch (error) {
      this.#recordCleanupFailure('SSH smoke local cleanup failed', error)
    }
  }

  /** @returns {void} */
  #cleanupRemote() {
    if (!this.#remoteTouched) {
      return
    }

    if (this.#configuration.keepRemote) {
      console.log(`SSH smoke: kept remote staging directory ${this.#configuration.remoteDirectory}`)

      return
    }

    try {
      runCommand(
        'ssh',
        sshArguments(this.#configuration.destination, `rm -rf -- ${this.#configuration.remoteDirectory}`),
        {
          label: 'remote smoke cleanup',
          timeout: 15_000,
          stdio: 'inherit'
        }
      )
    } catch (error) {
      this.#recordCleanupFailure('SSH smoke cleanup failed', error)
    }
  }

  /**
   * @param {string} label
   * @param {unknown} error
   * @returns {void}
   */
  #recordCleanupFailure(label, error) {
    if (!this.#failure) {
      this.#failure = error
    } else {
      console.error(`${label}: ${errorMessage(error)}`)
    }
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{label: string, timeout: number, [key: string]: unknown}} options
 * @returns {import('node:child_process').SpawnSyncReturns<string | Buffer>}
 */
function runCommand(command, args, options) {
  const { label, timeout, ...spawnOptions } = options
  const result = spawnSync(command, args, {
    timeout,
    maxBuffer: 1024 * 1024,
    ...spawnOptions
  })

  if (result.error) {
    throw new Error(`${label} failed`, { cause: result.error })
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim()
    const detail = stderr ? `: ${stderr}` : ''

    throw new Error(`${label} exited with status ${result.status ?? 'unknown'}${detail}`)
  }

  return result
}

/**
 * @param {string} destination
 * @param {string} command
 * @returns {string[]}
 */
function sshArguments(destination, command) {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', destination, command]
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

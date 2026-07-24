import { randomUUID } from 'node:crypto'
import path from 'node:path'

const requiredEnvironment = ['BENCHKIT_SSH_DESTINATION', 'BENCHKIT_SSH_CONNECT_HOST']

/**
 * @param {Record<string, string | undefined>} environment
 * @param {string} token
 * @returns {{
 *   destination: string,
 *   connectHost: string,
 *   remoteDirectory: string,
 *   keepRemote: boolean
 * }}
 */
export function resolveSshSmokeConfiguration(environment, token = randomUUID()) {
  const missingEnvironment = requiredEnvironment.filter((name) => !environment[name])

  if (missingEnvironment.length > 0) {
    throw new Error(`missing SSH smoke environment: ${missingEnvironment.join(', ')}`)
  }

  const destination = environment.BENCHKIT_SSH_DESTINATION
  const connectHost = environment.BENCHKIT_SSH_CONNECT_HOST
  const remoteBaseInput = environment.BENCHKIT_SSH_REMOTE_BASE ?? '/tmp'
  const remoteBase = path.posix.normalize(remoteBaseInput)

  if (
    destination.startsWith('-') ||
    /[\0\r\n\s]/u.test(destination) ||
    !connectHost ||
    /[\0\r\n\s]/u.test(connectHost)
  ) {
    throw new Error('SSH smoke destination and connect host must not contain whitespace or control characters')
  }

  if (
    !remoteBase.startsWith('/') ||
    remoteBase === '/' ||
    !/^[A-Za-z0-9_./-]+$/u.test(remoteBase) ||
    remoteBaseInput.split('/').includes('..')
  ) {
    throw new Error('BENCHKIT_SSH_REMOTE_BASE must be an absolute shell-safe path without ".." segments')
  }

  if (!/^[A-Za-z0-9-]+$/u.test(token)) {
    throw new Error('SSH smoke staging token must contain only letters, digits, and hyphens')
  }

  return {
    destination,
    connectHost,
    remoteDirectory: path.posix.join(remoteBase, `benchkit-smoke-${token}`),
    keepRemote: environment.BENCHKIT_SSH_KEEP_REMOTE === '1'
  }
}

/**
 * @param {string} output
 * @returns {22 | 24}
 */
export function parseSupportedNodeVersion(output) {
  const match = /^v(22|24)\.\d+\.\d+$/u.exec(output.trim())

  if (!match) {
    throw new Error(`remote Node.js must be version 22 or 24; received ${output.trim() || '<empty>'}`)
  }

  return Number(match[1])
}

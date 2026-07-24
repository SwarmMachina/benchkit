import { ConfigurationError, VersionMismatchError } from '../control/errors.js'
import { isRecord } from '../control/value-guards.js'
import { BENCHKIT_VERSION, PROTOCOL_VERSION } from '../control/version.js'
import type { AgentConfiguration } from '../target-provider/types.js'

const MAX_CONFIG_BYTES = 128 * 1024

export function decodeAgentConfiguration(encoded: string): AgentConfiguration {
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil((MAX_CONFIG_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)
  ) {
    throw new ConfigurationError('Agent configuration is not valid bounded base64')
  }

  const raw = Buffer.from(encoded, 'base64')

  if (raw.byteLength > MAX_CONFIG_BYTES) {
    throw new ConfigurationError(`Agent configuration exceeds ${MAX_CONFIG_BYTES} bytes`)
  }

  let value: unknown

  try {
    value = JSON.parse(raw.toString('utf8'))
  } catch (cause) {
    throw new ConfigurationError('Agent configuration is not valid JSON', undefined, { cause })
  }

  if (!isRecord(value)) {
    throw new ConfigurationError('Agent configuration must be an object')
  }

  if (value.protocolVersion !== PROTOCOL_VERSION) {
    throw new VersionMismatchError('protocol', PROTOCOL_VERSION, String(value.protocolVersion))
  }

  if (value.benchkitVersion !== BENCHKIT_VERSION) {
    throw new VersionMismatchError('package', BENCHKIT_VERSION, String(value.benchkitVersion))
  }

  for (const key of ['diagnosticsMaxBytes', 'commandMs', 'shutdownGraceMs', 'killMs'] as const) {
    if (!Number.isFinite(value[key]) || (value[key] as number) <= 0) {
      throw new ConfigurationError(`Agent configuration ${key} must be positive`)
    }
  }

  return value as unknown as AgentConfiguration
}

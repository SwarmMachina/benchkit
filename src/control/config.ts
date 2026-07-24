import { ConfigurationError } from './errors.js'
import { isPort } from './value-guards.js'

/** Inclusive `[minimum, maximum]` TCP port range. */
export type PortRange = readonly [number, number]

/** Independent deadlines used by target-provider lifecycle operations. */
export interface TimeoutOptions {
  /** Control transport connection deadline in milliseconds. */
  connectMs: number

  /** Target agent readiness deadline in milliseconds. */
  agentStartupMs: number

  /** Target-process IPC readiness deadline in milliseconds. */
  targetReadyMs: number

  /** Individual control command deadline in milliseconds. */
  commandMs: number

  /** Overall target network reachability deadline in milliseconds. */
  reachabilityMs: number

  /** Delay between reachability attempts in milliseconds. */
  reachabilityRetryMs: number

  /** Graceful target shutdown deadline in milliseconds. */
  shutdownGraceMs: number

  /** Forced target shutdown deadline in milliseconds. */
  killMs: number
}

export const DEFAULT_TIMEOUTS: TimeoutOptions = {
  connectMs: 10_000,
  agentStartupMs: 10_000,
  targetReadyMs: 60_000,
  commandMs: 15_000,
  reachabilityMs: 10_000,
  reachabilityRetryMs: 100,
  shutdownGraceMs: 2_000,
  killMs: 2_000
}

export function validateHost(host: unknown, field: string, { connect = false } = {}): string {
  if (typeof host !== 'string' || host.length === 0 || /\s|\0/u.test(host)) {
    throw new ConfigurationError(`${field} must be a non-empty host without whitespace or control characters`)
  }

  if (connect && ['0.0.0.0', '::', '[::]', '*'].includes(host)) {
    throw new ConfigurationError(`${field} cannot be a wildcard bind address`, { field, host })
  }

  if (host.includes('://') || (host.startsWith('[') ? !host.endsWith(']') : host.includes(':'))) {
    throw new ConfigurationError(`${field} must contain a host only, without a URL scheme or port`, { field, host })
  }

  return host.startsWith('[') ? host.slice(1, -1) : host
}

export function validateDestination(destination: unknown): string {
  if (
    typeof destination !== 'string' ||
    destination.length === 0 ||
    destination.startsWith('-') ||
    /[\0\r\n\s]/u.test(destination)
  ) {
    throw new ConfigurationError('ssh.destination must be a non-empty SSH destination without whitespace')
  }

  return destination
}

export function validatePortRange(range: unknown): PortRange {
  if (!Array.isArray(range) || range.length !== 2) {
    throw new ConfigurationError('port.range must be a [minimum, maximum] tuple')
  }

  const [minimum, maximum] = range

  if (!isPort(minimum) || !isPort(maximum) || minimum > maximum) {
    throw new ConfigurationError('port.range must contain ordered integer ports between 1 and 65535')
  }

  return [minimum, maximum]
}

export function resolveTimeouts(options: Partial<TimeoutOptions> | undefined): TimeoutOptions {
  const resolved = { ...DEFAULT_TIMEOUTS, ...options }

  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new ConfigurationError(`timeouts.${name} must be a positive number`)
    }
  }

  return resolved
}

import os from 'node:os'

/** Host and Node.js runtime metadata captured with benchmark artifacts. */
export interface EnvironmentSnapshot {
  /** Node.js version including the leading `v`. */
  nodeVersion: string

  /** Operating-system platform reported by `process.platform`. */
  platform: NodeJS.Platform

  /** CPU architecture reported by `process.arch`. */
  arch: string

  /** Operating-system hostname. */
  hostname: string

  /** Operating-system release identifier. */
  osRelease: string

  /** Model of the first logical CPU, or `null` when unavailable. */
  cpuModel: string | null

  /** Number of logical CPUs visible to the process. */
  cpuCount: number

  /** Total system memory in bytes. */
  totalMemoryBytes: number
}

/**
 * Captures stable host and Node.js runtime metadata for a benchmark artifact.
 * @returns A new environment snapshot. No process identifiers or environment
 * variables are included.
 */
export function snapshotEnvironment(): EnvironmentSnapshot {
  const cpus = os.cpus()

  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    osRelease: os.release(),
    cpuModel: cpus[0]?.model ?? null,
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem()
  }
}

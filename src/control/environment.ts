import os from 'node:os'

export interface EnvironmentSnapshot {
  nodeVersion: string
  platform: NodeJS.Platform
  arch: string
  hostname: string
  osRelease: string
  cpuModel: string | null
  cpuCount: number
  totalMemoryBytes: number
}

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

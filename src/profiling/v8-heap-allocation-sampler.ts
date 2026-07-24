import { Session } from 'node:inspector'

export interface V8HeapAllocationSamplerOptions {
  samplingIntervalBytes?: number
  includeCollectedObjects?: boolean
}

export interface V8AllocationProfileNode {
  selfSize: number
  children: V8AllocationProfileNode[]
  [key: string]: unknown
}

export interface V8AllocationProfile {
  head: V8AllocationProfileNode
  samples?: unknown[]
  [key: string]: unknown
}

export interface V8HeapAllocationResult {
  sampledAllocationBytes: number
  profile: V8AllocationProfile
}

export interface V8HeapAllocationRunResult<Value> extends V8HeapAllocationResult {
  value: Value
}

export class V8HeapAllocationSampler {
  readonly #options: Required<V8HeapAllocationSamplerOptions>
  readonly #session = new Session()
  #connected = false
  #enabled = false
  #running = false
  #disposed = false

  constructor({
    samplingIntervalBytes = 32 * 1024,
    includeCollectedObjects = true
  }: V8HeapAllocationSamplerOptions = {}) {
    if (!Number.isSafeInteger(samplingIntervalBytes) || samplingIntervalBytes <= 0) {
      throw new RangeError('samplingIntervalBytes must be a positive safe integer')
    }

    if (typeof includeCollectedObjects !== 'boolean') {
      throw new TypeError('includeCollectedObjects must be a boolean')
    }

    this.#options = { samplingIntervalBytes, includeCollectedObjects }
  }

  async start(): Promise<void> {
    if (this.#disposed) {
      throw new Error('V8 heap allocation sampler is disposed')
    }

    if (this.#running) {
      throw new Error('V8 heap allocation sampler is already running')
    }

    try {
      if (!this.#connected) {
        this.#session.connect()
        this.#connected = true
      }

      if (!this.#enabled) {
        await this.#post('HeapProfiler.enable')
        this.#enabled = true
      }

      await this.#post('HeapProfiler.startSampling', {
        samplingInterval: this.#options.samplingIntervalBytes,
        includeObjectsCollectedByMajorGC: this.#options.includeCollectedObjects,
        includeObjectsCollectedByMinorGC: this.#options.includeCollectedObjects
      })
      this.#running = true
    } catch (error) {
      await this.dispose().catch(() => {})
      throw error
    }
  }

  async stop(): Promise<V8HeapAllocationResult> {
    if (!this.#running) {
      throw new Error('V8 heap allocation sampler is not running')
    }

    const result = await this.#post<{ profile: V8AllocationProfile }>('HeapProfiler.stopSampling')

    this.#running = false

    return {
      sampledAllocationBytes: sampledAllocationBytes(result.profile),
      profile: result.profile
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return
    }

    let cleanupError: unknown

    if (this.#running) {
      try {
        await this.#post('HeapProfiler.stopSampling')
      } catch (error) {
        cleanupError = error
      }

      this.#running = false
    }

    if (this.#enabled) {
      try {
        await this.#post('HeapProfiler.disable')
      } catch (error) {
        cleanupError ??= error
      }

      this.#enabled = false
    }

    if (this.#connected) {
      this.#session.disconnect()
      this.#connected = false
    }

    this.#disposed = true

    if (cleanupError) {
      throw cleanupError
    }
  }

  #post<Result = object>(method: string, params?: Record<string, unknown>): Promise<Result> {
    return new Promise((resolve, reject) => {
      const callback = (error: Error | null, result?: object): void => {
        if (error) {
          reject(error)
        } else {
          resolve((result ?? {}) as Result)
        }
      }

      if (params) {
        this.#session.post(method, params, callback)
      } else {
        this.#session.post(method, callback)
      }
    })
  }
}

export async function sampleV8HeapAllocations<Value>(
  run: () => Value | Promise<Value>,
  options: V8HeapAllocationSamplerOptions = {}
): Promise<V8HeapAllocationRunResult<Value>> {
  if (typeof run !== 'function') {
    throw new TypeError('run must be a function')
  }

  const sampler = new V8HeapAllocationSampler(options)

  try {
    await sampler.start()

    const value = await run()
    const result = await sampler.stop()

    return { value, ...result }
  } finally {
    await sampler.dispose()
  }
}

export function sampledAllocationBytes(profile: V8AllocationProfile): number {
  if (!profile?.head || typeof profile.head !== 'object') {
    throw new TypeError('profile.head must be an allocation profile node')
  }

  let total = 0

  const pending = [profile.head]

  while (pending.length) {
    const node = pending.pop()

    if (!node || !Number.isFinite(node.selfSize) || node.selfSize < 0 || !Array.isArray(node.children)) {
      throw new TypeError('allocation profile contains an invalid node')
    }

    total += node.selfSize
    pending.push(...node.children)
  }

  return total
}

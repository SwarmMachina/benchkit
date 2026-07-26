import { Session } from 'node:inspector'
import { isNonNegativeFiniteNumber, isPositiveSafeInteger } from '../validation/predicates.js'

/** Configuration for V8 inspector heap-allocation sampling. */
export interface V8HeapAllocationSamplerOptions {
  /**
   * Mean byte interval between allocation samples.
   * @default `32_768`
   */
  samplingIntervalBytes?: number

  /**
   * Includes objects collected before sampling stops.
   * @default `true`
   */
  includeCollectedObjects?: boolean
}

/** Allocation call-tree node returned by the V8 HeapProfiler domain. */
export interface V8AllocationProfileNode {
  /** Sampled bytes attributed directly to this node. */
  selfSize: number

  /** Child allocation call-tree nodes. */
  children: V8AllocationProfileNode[]

  /** Additional V8 protocol fields preserved without interpretation. */
  [key: string]: unknown
}

/** Allocation sampling profile returned by V8 HeapProfiler. */
export interface V8AllocationProfile {
  /** Root allocation call-tree node. */
  head: V8AllocationProfileNode

  /** Optional raw sample records supplied by V8. */
  samples?: unknown[]

  /** Additional V8 protocol fields preserved without interpretation. */
  [key: string]: unknown
}

/** Profile and sampled allocation total for one interval. */
export interface V8HeapAllocationResult {
  /** Sum of `selfSize` across the allocation call tree. */
  sampledAllocationBytes: number

  /** Raw V8 allocation sampling profile. */
  profile: V8AllocationProfile
}

/** Allocation result paired with the measured operation return value. */
export interface V8HeapAllocationRunResult<Value> extends V8HeapAllocationResult {
  /** Value returned by the measured operation. */
  value: Value
}

/** Explicit-lifecycle wrapper around the V8 inspector allocation sampler. */
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
    if (!isPositiveSafeInteger(samplingIntervalBytes)) {
      throw new RangeError('samplingIntervalBytes must be a positive safe integer')
    }

    if (typeof includeCollectedObjects !== 'boolean') {
      throw new TypeError('includeCollectedObjects must be a boolean')
    }

    this.#options = { samplingIntervalBytes, includeCollectedObjects }
  }

  /** Starts allocation sampling for the current process. */
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

  /** Stops sampling and returns the profile and sampled byte total. */
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

  /** Stops active sampling, disables HeapProfiler, and disconnects the inspector session. */
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

/**
 * Runs one operation while V8 heap-allocation sampling is active.
 *
 * The inspector session is disposed in a `finally` block even when the
 * operation or profiler fails.
 * @param run Operation whose allocations should be sampled.
 * @param options Heap profiler sampling configuration.
 * @returns The operation value together with its allocation profile and total bytes.
 * @throws {TypeError} If `run` is not a function or options are invalid.
 */
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

/**
 * Sums self-allocation bytes across an allocation profile tree.
 * @param profile V8 sampling heap profile.
 * @returns Total sampled self-size across every node.
 * @throws {TypeError} If the profile contains malformed nodes or sizes.
 */
export function sampledAllocationBytes(profile: V8AllocationProfile): number {
  if (!profile?.head || typeof profile.head !== 'object') {
    throw new TypeError('profile.head must be an allocation profile node')
  }

  let total = 0

  const pending = [profile.head]

  while (pending.length) {
    const node = pending.pop()

    if (!node || !isNonNegativeFiniteNumber(node.selfSize) || !Array.isArray(node.children)) {
      throw new TypeError('allocation profile contains an invalid node')
    }

    total += node.selfSize
    pending.push(...node.children)
  }

  return total
}

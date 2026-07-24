import os from 'node:os'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { bytesToMiB } from '../units/bytes-to-mib.js'

/** Options used when starting process and event-loop metrics collection. */
export interface MetricsStartOptions {
  /**
   * Process-memory and host-load sampling interval in milliseconds.
   * Values below 50 are clamped to 50.
   * @default `250`
   */
  sampleMs?: number
}

/** Event-loop delay percentiles and maximum in milliseconds. */
export interface EventLoopDelayMetrics {
  /** 50th percentile delay, or `null` when unavailable. */
  p50: number | null

  /** 90th percentile delay, or `null` when unavailable. */
  p90: number | null

  /** 99th percentile delay, or `null` when unavailable. */
  p99: number | null

  /** Maximum observed delay, or `null` when unavailable. */
  max: number | null
}

/** Peak process-memory values in mebibytes. */
export interface MemoryMetrics {
  /** Peak resident set size. */
  rssPeak: number

  /** Peak used V8 heap. */
  heapUsedPeak: number

  /** Peak V8 external memory. */
  externalPeak: number

  /** Peak `ArrayBuffer` memory. */
  arrayBuffersPeak: number
}

/** Process, event-loop, memory, and host-load metrics for one interval. */
export interface MetricsSummary {
  /** Measurement wall time in milliseconds. */
  wallMs: number

  /** Process user and system CPU time in milliseconds. */
  cpuMs: number

  /** Process CPU usage where 100% represents one fully occupied core. */
  cpuCorePct: number

  /** Process CPU usage divided by the host logical CPU count. */
  cpuHostPct: number

  /** Event-loop utilization expressed as a percentage. */
  eluPct: number

  /** Event-loop delay distribution in milliseconds. */
  eventLoopDelayMs: EventLoopDelayMetrics

  /** Peak process-memory values in mebibytes. */
  memMB: MemoryMetrics

  /** Mean 1, 5, and 15-minute host load averages across samples. */
  loadAvg: number[]

  /** Peak 1, 5, and 15-minute host load averages across samples. */
  loadPeak: number[]
}

/** Stateful collector for process, event-loop, memory, and host-load metrics. */
export default class Metrics {
  #running = false

  #sampleMs = 250
  #timer: ReturnType<typeof setInterval> | null = null

  #t0 = 0
  #cpu0: ReturnType<typeof process.cpuUsage> | null = null
  #elu0: ReturnType<typeof performance.eventLoopUtilization> | null = null
  #eld: ReturnType<typeof monitorEventLoopDelay> | null = null

  #peakRss = 0
  #peakHeap = 0
  #peakExternal = 0
  #peakArrayBuffers = 0

  #loadSum: [number, number, number] = [0, 0, 0]
  #loadPeak: [number, number, number] = [0, 0, 0]
  #samples = 0

  /**
   * Starts collection unless it is already running.
   *
   * Starting a running collector is a no-op.
   */
  start({ sampleMs }: MetricsStartOptions = {}): void {
    if (this.#running) {
      return
    }

    this.#running = true
    this.#sampleMs = Number.isFinite(sampleMs) ? Math.max(50, sampleMs as number) : 250

    this.#t0 = performance.now()
    this.#cpu0 = process.cpuUsage()
    this.#elu0 = performance.eventLoopUtilization()

    this.#peakRss = 0
    this.#peakHeap = 0
    this.#peakExternal = 0
    this.#peakArrayBuffers = 0
    this.#loadSum = [0, 0, 0]
    this.#loadPeak = [0, 0, 0]
    this.#samples = 0

    this.#eld = monitorEventLoopDelay({ resolution: 20 })
    this.#eld.enable()

    this.#timer = setInterval(() => this.#sample(), this.#sampleMs)
    this.#timer.unref?.()
  }

  /**
   * Stops collection and returns a summary.
   *
   * Returns `null` when the collector is not running.
   */
  stop(): MetricsSummary | null {
    if (!this.#running) {
      return null
    }

    this.#running = false

    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }

    if (this.#eld) {
      this.#eld.disable()
    }

    this.#sample()

    const dtMs = Math.max(1, performance.now() - this.#t0)
    const cpu = process.cpuUsage(this.#cpu0 as ReturnType<typeof process.cpuUsage>)
    const cpuMs = (cpu.user + cpu.system) / 1000
    const cpuCorePct = (cpuMs / dtMs) * 100
    const cpuHostPct = (cpuMs / (dtMs * os.cpus().length)) * 100
    const elu = performance.eventLoopUtilization(this.#elu0 as ReturnType<typeof performance.eventLoopUtilization>)
    const eluPct = (elu.utilization || 0) * 100
    const eld = this.#eld
    const eldP50 = eld ? eld.percentile(50) / 1e6 : null
    const eldP90 = eld ? eld.percentile(90) / 1e6 : null
    const eldP99 = eld ? eld.percentile(99) / 1e6 : null
    const eldMax = eld ? eld.max / 1e6 : null
    const loadAvg = this.#samples ? this.#loadSum.map((x) => x / this.#samples) : os.loadavg()

    return {
      wallMs: dtMs,
      cpuMs,
      cpuCorePct,
      cpuHostPct,
      eluPct,
      eventLoopDelayMs: {
        p50: eldP50,
        p90: eldP90,
        p99: eldP99,
        max: eldMax
      },
      memMB: {
        rssPeak: bytesToMiB(this.#peakRss),
        heapUsedPeak: bytesToMiB(this.#peakHeap),
        externalPeak: bytesToMiB(this.#peakExternal),
        arrayBuffersPeak: bytesToMiB(this.#peakArrayBuffers)
      },
      loadAvg,
      loadPeak: this.#loadPeak
    }
  }

  #sample(): void {
    const mu = process.memoryUsage()

    this.#peakRss = Math.max(this.#peakRss, mu.rss)
    this.#peakHeap = Math.max(this.#peakHeap, mu.heapUsed)
    this.#peakExternal = Math.max(this.#peakExternal, mu.external)
    this.#peakArrayBuffers = Math.max(this.#peakArrayBuffers, mu.arrayBuffers || 0)

    const [load1 = 0, load5 = 0, load15 = 0] = os.loadavg()

    this.#loadSum[0] += load1
    this.#loadSum[1] += load5
    this.#loadSum[2] += load15
    this.#loadPeak[0] = Math.max(this.#loadPeak[0], load1)
    this.#loadPeak[1] = Math.max(this.#loadPeak[1], load5)
    this.#loadPeak[2] = Math.max(this.#loadPeak[2], load15)
    this.#samples++
  }
}

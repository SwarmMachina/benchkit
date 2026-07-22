import os from 'node:os'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { bytesToMiB } from '../units/bytes-to-mib.js'

export interface MetricsStartOptions {
  sampleMs?: number
}

export interface EventLoopDelayMetrics {
  p50: number | null
  p90: number | null
  p99: number | null
  max: number | null
}

export interface MemoryMetrics {
  rssPeak: number
  heapUsedPeak: number
  externalPeak: number
  arrayBuffersPeak: number
}

export interface MetricsSummary {
  wallMs: number
  cpuMs: number
  cpuCorePct: number
  cpuHostPct: number
  eluPct: number
  eventLoopDelayMs: EventLoopDelayMetrics
  memMB: MemoryMetrics
  loadAvg: number[]
  loadPeak: number[]
}

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

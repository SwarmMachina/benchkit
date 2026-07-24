/** File paths associated with a processed V8 CPU profile. */
export interface BenchmarkProfileArtifacts {
  /** Path to the processed profile report. */
  processedPath?: string

  /** Path to the original V8 profiler log. */
  logPath?: string
}

/** Minimum row shape accepted by generic benchmark results. */
export interface FrameworkBenchmarkRow {
  /** Framework or implementation identifier. */
  fw: string
}

/** Benchmark row that may reference V8 CPU profile artifacts. */
export interface ProfiledBenchmarkRow extends FrameworkBenchmarkRow {
  /** Profile artifact paths, or `null` when profiling was not collected. */
  v8prof: BenchmarkProfileArtifacts | null
}

/** Ordered benchmark rows produced by one run. */
export interface BenchmarkRun<Row extends FrameworkBenchmarkRow = FrameworkBenchmarkRow> {
  /** One-based or caller-defined run identifier. */
  run: number

  /** Scenario rows captured during this run. */
  rows: Row[]
}

/** Generic multi-run benchmark result with optional aggregate rows. */
export interface BenchmarkResult<Row extends FrameworkBenchmarkRow = FrameworkBenchmarkRow> {
  /** Individual benchmark runs in execution order. */
  runs: Array<BenchmarkRun<Row>>

  /** Optional caller-computed median rows. */
  median?: Row[]
}

/** Benchmark result whose rows may reference V8 CPU profiles. */
export type ProfiledBenchmarkResult = BenchmarkResult<ProfiledBenchmarkRow>

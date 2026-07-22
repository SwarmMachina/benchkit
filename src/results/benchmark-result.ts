export interface BenchmarkProfileArtifacts {
  processedPath?: string
  logPath?: string
}

export interface FrameworkBenchmarkRow {
  fw: string
}

export interface ProfiledBenchmarkRow extends FrameworkBenchmarkRow {
  v8prof: BenchmarkProfileArtifacts | null
}

export interface BenchmarkRun<Row extends FrameworkBenchmarkRow = FrameworkBenchmarkRow> {
  run: number
  rows: Row[]
}

export interface BenchmarkResult<Row extends FrameworkBenchmarkRow = FrameworkBenchmarkRow> {
  runs: Array<BenchmarkRun<Row>>
  median?: Row[]
}

export type ProfiledBenchmarkResult = BenchmarkResult<ProfiledBenchmarkRow>

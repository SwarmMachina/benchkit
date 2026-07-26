import fs from 'node:fs/promises'
import path from 'node:path'
import ensureDir from '../orchestration/ensure-dir.js'
import type { BenchmarkRun, ProfiledBenchmarkResult, ProfiledBenchmarkRow } from '../results/benchmark-result.js'
import type { CpuProfile } from '../regression/cpu-guard.js'
import parseV8Profile from './v8-prof-parser.js'

/** Profile-capable benchmark row accepted by `copyCpuProfiles`. */
export type BenchRow = ProfiledBenchmarkRow

/** Profile-capable benchmark run accepted by `copyCpuProfiles`. */
export type BenchRun = BenchmarkRun<ProfiledBenchmarkRow>

/** Profile-capable benchmark result accepted by `copyCpuProfiles`. */
export type Bench = ProfiledBenchmarkResult

/**
 * Copies V8 CPU-profile artifacts into a stable benchmark artifact directory.
 *
 * Processed profiles are parsed while raw isolate logs are preserved verbatim.
 * @param bench Profile-capable benchmark result.
 * @param test Stable benchmark case identifier.
 * @param outDir Artifact root receiving a `cpu` directory.
 * @param cwd Source-path prefix removed from parsed profile locations.
 * @returns Metadata for every copied benchmark-row profile.
 */
export default async function copyCpuProfiles(
  bench: Bench,
  test: string,
  outDir: string,
  cwd = ''
): Promise<CpuProfile[]> {
  const copied: CpuProfile[] = []
  const cpuDir = path.join(outDir, 'cpu')

  await ensureDir(cpuDir)

  for (const run of bench.runs) {
    for (const row of run.rows) {
      if (!row.v8prof) {
        continue
      }

      const dir = await fs.mkdtemp(path.join(cpuDir, `${test}-run-${run.run}-${row.fw}-`))
      const item: CpuProfile = { test, run: run.run, fw: row.fw }

      if (row.v8prof.processedPath) {
        const dest = path.join(dir, 'profile.txt')

        await fs.copyFile(row.v8prof.processedPath, dest)
        item.processedPath = path.relative(outDir, dest)
        item.profile = parseV8Profile(await fs.readFile(dest, 'utf8'), { cwd })
      }

      if (row.v8prof.logPath) {
        const dest = path.join(dir, path.basename(row.v8prof.logPath))

        await fs.copyFile(row.v8prof.logPath, dest)
        item.logPath = path.relative(outDir, dest)
      }

      copied.push(item)
    }
  }

  return copied
}

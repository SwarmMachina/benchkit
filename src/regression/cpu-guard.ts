import type { V8Profile } from '../profiling/v8-prof-parser.js'

/** Parsed and copied CPU profile associated with one benchmark row. */
export interface CpuProfile {
  /** Benchmark case identifier. */
  test: string

  /** Run identifier. */
  run: number

  /** Framework or implementation identifier. */
  fw: string

  /** Parsed V8 profile when a processed report exists. */
  profile?: V8Profile

  /** Copied processed-profile path relative to the artifact root. */
  processedPath?: string

  /** Copied V8 log path relative to the artifact root. */
  logPath?: string
}

/** Optional CPU profile quality and regression thresholds. */
export interface CpuGuardConfig {
  /** Requires a profile for every expected benchmark key. */
  profileRequired?: boolean

  /** Minimum acceptable profiler tick count. */
  minTotalTicks?: number

  /** Maximum acceptable GC share as a percentage of all ticks. */
  maxGcPct?: number

  /** Maximum acceptable unaccounted share as a percentage of all ticks. */
  maxUnaccountedPct?: number
}

/** CPU profiles, policy, and expected keys supplied to `cpuGuard`. */
export interface CpuGuardParams {
  /** Collected CPU profiles. */
  cpuProfiles: CpuProfile[]

  /** Guard policy, or `undefined` to disable the guard. */
  guard: CpuGuardConfig | undefined

  /** Required `test:run:framework` keys when profiles are mandatory. */
  expectedKeys: string[]
}

/** Normalized CPU profile row rendered in regression reports. */
export interface CpuGuardRow {
  /** `test:run:framework` profile key. */
  key: string

  /** Total profiler ticks, or `null` when unavailable. */
  ticks: number | null

  /** JavaScript tick share, or `null` when unavailable. */
  jsPct: number | null

  /** Native C++ tick share, or `null` when unavailable. */
  cppPct: number | null

  /** Garbage-collection tick share, or `null` when unavailable. */
  gcPct: number | null

  /** Unaccounted tick share, or `null` when unavailable. */
  unaccountedPct: number | null
}

/** CPU guard failures and normalized report rows. */
export interface CpuGuardResult {
  /** Human-readable policy violations. */
  failures: string[]

  /** Parsed profile rows considered by the guard. */
  rows: CpuGuardRow[]
}

/**
 * Evaluates V8 CPU profiles against sampling-quality and GC-share thresholds.
 * @param params Collected profiles, optional policy, and required profile keys.
 * @param params.cpuProfiles Collected and parsed CPU profiles.
 * @param params.guard Optional sampling-quality and regression policy.
 * @param params.expectedKeys Required profile keys when profiles are mandatory.
 * @returns Normalized rows and every policy failure; an omitted policy disables the guard.
 */
export default function cpuGuard({ cpuProfiles, guard, expectedKeys }: CpuGuardParams): CpuGuardResult {
  if (!guard) {
    return { failures: [], rows: [] }
  }

  const failures: string[] = []
  const rows: CpuGuardRow[] = []
  const expected = new Set(guard.profileRequired ? expectedKeys : [])

  for (const item of cpuProfiles || []) {
    const key = `${item.test}:${item.run}:${item.fw}`
    const profile = item.profile

    expected.delete(key)

    if (!profile) {
      failures.push(`${key}: missing parsed CPU profile`)
      continue
    }

    const gcPct = profile.summary.gc?.totalPct ?? null
    const unaccountedPct = profile.summary.unaccounted?.totalPct ?? null

    rows.push({
      key,
      ticks: profile.totalTicks,
      jsPct: profile.summary.javascript?.totalPct ?? null,
      cppPct: profile.summary.c?.totalPct ?? null,
      gcPct,
      unaccountedPct
    })

    if (!Number.isFinite(profile.totalTicks)) {
      failures.push(`${key}: missing CPU profile tick count`)
    }

    if (
      guard.minTotalTicks != null &&
      Number.isFinite(profile.totalTicks) &&
      (profile.totalTicks as number) < guard.minTotalTicks
    ) {
      failures.push(`${key}: CPU profile ticks ${profile.totalTicks} < ${guard.minTotalTicks}`)
    }

    if (guard.maxGcPct != null && Number.isFinite(gcPct) && (gcPct as number) > guard.maxGcPct) {
      failures.push(`${key}: GC ${gcPct}% > ${guard.maxGcPct}%`)
    }

    if (
      guard.maxUnaccountedPct != null &&
      Number.isFinite(unaccountedPct) &&
      (unaccountedPct as number) > guard.maxUnaccountedPct
    ) {
      failures.push(`${key}: unaccounted ${unaccountedPct}% > ${guard.maxUnaccountedPct}%`)
    }
  }

  for (const missing of expected) {
    failures.push(`${missing}: missing CPU profile`)
  }

  return { failures, rows }
}

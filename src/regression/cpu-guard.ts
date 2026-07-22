import type { V8Profile } from '../profiling/v8-prof-parser.js'

export interface CpuProfile {
  test: string
  run: number
  fw: string
  profile?: V8Profile
  processedPath?: string
  logPath?: string
}

export interface CpuGuardConfig {
  profileRequired?: boolean
  minTotalTicks?: number
  maxGcPct?: number
  maxUnaccountedPct?: number
}

export interface CpuGuardParams {
  cpuProfiles: CpuProfile[]
  guard: CpuGuardConfig | undefined
  expectedKeys: string[]
}

export interface CpuGuardRow {
  key: string
  ticks: number | null
  jsPct: number | null
  cppPct: number | null
  gcPct: number | null
  unaccountedPct: number | null
}

export interface CpuGuardResult {
  failures: string[]
  rows: CpuGuardRow[]
}

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

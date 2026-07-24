/** One parsed row from a V8 statistical profiler section. */
export interface V8ProfileRow {
  /** Samples attributed to this entry. */
  ticks: number

  /** Percentage of all profiler ticks. */
  totalPct: number

  /** Percentage excluding shared-library ticks, or `null` when omitted. */
  nonlibPct: number | null

  /** Normalized symbol, source location, or category name. */
  name: string
}

/** Aggregated entry from the V8 profiler summary section. */
export interface V8ProfileSummaryEntry {
  /** Samples attributed to this category. */
  ticks: number

  /** Percentage of all profiler ticks. */
  totalPct: number

  /** Percentage excluding shared-library ticks, or `null` when omitted. */
  nonlibPct: number | null
}

/** Structured representation of processed `node --prof` output. */
export interface V8Profile {
  /** Total profiler ticks, or `null` when unavailable. */
  totalTicks: number | null

  /** Ticks V8 could not attribute, or `null` when unavailable. */
  unaccountedTicks: number | null

  /** Ticks excluded by V8 processing, or `null` when unavailable. */
  excludedTicks: number | null

  /** Summary categories keyed by normalized lower-case names. */
  summary: Record<string, V8ProfileSummaryEntry>

  /** Highest-ranked JavaScript entries. */
  topJavaScript: V8ProfileRow[]

  /** Highest-ranked native C++ entries. */
  topNative: V8ProfileRow[]

  /** Highest-ranked shared-library entries. */
  topSharedLibraries: V8ProfileRow[]
}

/** Normalization and output limits for processed V8 profiler text. */
export interface V8ProfileOptions {
  /**
   * Working-directory prefix removed from parsed source locations.
   * @default `''`
   */
  cwd?: string

  /**
   * Maximum rows retained from each detailed section.
   * @default `10`
   */
  topN?: number
}

interface V8ProfileHeader {
  totalTicks?: number
  unaccountedTicks?: number
  excludedTicks?: number
}

export default function parseV8Profile(text: string, { cwd = '', topN = 10 }: V8ProfileOptions = {}): V8Profile {
  const lines = String(text).split(/\r?\n/)
  const header = parseHeader(lines)
  const sections = parseSections(lines, cwd)
  const summaryRows = sections.get('Summary') || []
  const summary = Object.create(null) as Record<string, V8ProfileSummaryEntry>

  for (const row of summaryRows) {
    summary[summaryKey(row.name)] = {
      ticks: row.ticks,
      totalPct: row.totalPct,
      nonlibPct: row.nonlibPct
    }
  }

  return {
    totalTicks: header.totalTicks ?? sumTicks(summaryRows),
    unaccountedTicks: header.unaccountedTicks ?? summary.unaccounted?.ticks ?? null,
    excludedTicks: header.excludedTicks ?? null,
    summary,
    topJavaScript: topRows(sections.get('JavaScript'), topN),
    topNative: topRows(sections.get('C++'), topN),
    topSharedLibraries: topRows(sections.get('Shared libraries'), topN)
  }
}

function parseHeader(lines: string[]): V8ProfileHeader {
  const first = lines.find((line) => line.startsWith('Statistical profiling result'))
  const match = first?.match(/\((\d+) ticks,\s+(\d+) unaccounted,\s+(\d+) excluded\)/)

  if (!match) {
    return {}
  }

  const [, totalTicks, unaccountedTicks, excludedTicks] = match

  if (totalTicks === undefined || unaccountedTicks === undefined || excludedTicks === undefined) {
    return {}
  }

  return {
    totalTicks: Number(totalTicks),
    unaccountedTicks: Number(unaccountedTicks),
    excludedTicks: Number(excludedTicks)
  }
}

function parseSections(lines: string[], cwd: string): Map<string, V8ProfileRow[]> {
  const sections = new Map<string, V8ProfileRow[]>()

  let section: string | null = null

  for (const line of lines) {
    const sectionMatch = line.match(/^\s+\[(.+?)\]:\s*$/)
    const sectionName = sectionMatch?.[1]

    if (sectionName !== undefined) {
      section = sectionName
      sections.set(section, [])
      continue
    }

    if (!section) {
      continue
    }

    const row = parseRow(line, cwd)

    if (row) {
      sections.get(section)?.push(row)
    }
  }

  return sections
}

function parseRow(line: string, cwd: string): V8ProfileRow | null {
  const match = line.match(/^\s*(\d+)\s+([\d.]+)%\s+(?:(\d+(?:\.\d+)?)%\s+)?(.+?)\s*$/)

  if (!match) {
    return null
  }

  const [, ticks, totalPct, nonlibPct, name] = match

  if (ticks === undefined || totalPct === undefined || name === undefined || name === 'name') {
    return null
  }

  return {
    ticks: Number(ticks),
    totalPct: Number(totalPct),
    nonlibPct: nonlibPct == null ? null : Number(nonlibPct),
    name: normalizeName(name, cwd)
  }
}

function normalizeName(name: string, cwd: string): string {
  let out = name.replaceAll('file://', '')

  if (cwd) {
    out = out.replaceAll(`${cwd}/`, '')
  }

  return out
}

function summaryKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
}

function topRows(rows: V8ProfileRow[] | undefined, topN: number): V8ProfileRow[] {
  return (rows || []).slice(0, topN)
}

function sumTicks(rows: V8ProfileRow[]): number | null {
  if (!rows.length) {
    return null
  }

  return rows.reduce((sum, row) => sum + row.ticks, 0)
}

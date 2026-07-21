export interface V8ProfileRow {
  ticks: number
  totalPct: number
  nonlibPct: number | null
  name: string
}

export interface V8ProfileSummaryEntry {
  ticks: number
  totalPct: number
  nonlibPct: number | null
}

export interface V8Profile {
  totalTicks: number | null
  unaccountedTicks: number | null
  excludedTicks: number | null
  summary: Record<string, V8ProfileSummaryEntry>
  topJavaScript: V8ProfileRow[]
  topNative: V8ProfileRow[]
  topSharedLibraries: V8ProfileRow[]
}

export interface V8ProfileOptions {
  cwd?: string
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

  return {
    totalTicks: Number(match[1]),
    unaccountedTicks: Number(match[2]),
    excludedTicks: Number(match[3])
  }
}

function parseSections(lines: string[], cwd: string): Map<string, V8ProfileRow[]> {
  const sections = new Map<string, V8ProfileRow[]>()

  let section: string | null = null

  for (const line of lines) {
    const sectionMatch = line.match(/^\s+\[(.+?)\]:\s*$/)

    if (sectionMatch) {
      section = sectionMatch[1]
      sections.set(section, [])
      continue
    }

    if (!section) {
      continue
    }

    const row = parseRow(line, cwd)

    if (row) {
      sections.get(section)!.push(row)
    }
  }

  return sections
}

function parseRow(line: string, cwd: string): V8ProfileRow | null {
  const match = line.match(/^\s*(\d+)\s+([\d.]+)%\s+(?:(\d+(?:\.\d+)?)%\s+)?(.+?)\s*$/)

  if (!match || match[4] === 'name') {
    return null
  }

  return {
    ticks: Number(match[1]),
    totalPct: Number(match[2]),
    nonlibPct: match[3] == null ? null : Number(match[3]),
    name: normalizeName(match[4], cwd)
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

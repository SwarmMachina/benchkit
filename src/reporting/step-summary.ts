import fs from 'node:fs/promises'

export async function appendStepSummary(md: string): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY

  if (file) {
    await fs.appendFile(file, `${md}\n`)
  } else {
    console.log(md)
  }
}

export function round(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : v
}

export function fmt(v: number, unit = ''): string {
  return Number.isFinite(v) ? `${round(v)}${unit}` : 'n/a'
}

export function mdTable(headers: string[], rows: Array<Array<string | number>>): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n')

  return [head, sep, body].join('\n')
}

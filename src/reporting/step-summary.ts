import fs from 'node:fs/promises'

/**
 * Appends Markdown to the GitHub Actions step summary or prints it locally.
 * @param md Markdown fragment to append.
 * @returns A Promise that resolves after the summary is written.
 */
export async function appendStepSummary(md: string): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY

  if (file) {
    await fs.appendFile(file, `${md}\n`)
  } else {
    console.log(md)
  }
}

/**
 * Rounds a finite number to two decimal places.
 * @param v Number to round.
 * @returns The rounded value, or the unchanged non-finite value.
 */
export function round(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : v
}

/**
 * Formats a rounded finite value with an optional unit suffix.
 * @param v Number to format.
 * @param unit Suffix appended without an extra separator.
 * @returns Formatted text, or `'n/a'` for non-finite input.
 */
export function fmt(v: number, unit = ''): string {
  return Number.isFinite(v) ? `${round(v)}${unit}` : 'n/a'
}

/**
 * Renders a basic left-aligned Markdown table.
 * @param headers Column headings.
 * @param rows Row values in display order.
 * @returns Complete Markdown table text.
 */
export function mdTable(headers: string[], rows: Array<Array<string | number>>): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n')

  return [head, sep, body].join('\n')
}

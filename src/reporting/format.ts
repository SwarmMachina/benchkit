/** Rounds a nullable finite measurement for console-table output. */
export function fixed(value: number | null): number | string {
  return value === null || !Number.isFinite(value) ? 'n/a' : Number(value.toFixed(2))
}

/** Formats a finite measurement with two decimals and an optional unit suffix. */
export function fixedWithUnit(value: number, unit = ''): string {
  return Number.isFinite(value) ? `${value.toFixed(2)}${unit}` : 'n/a'
}

/** Formats a finite number with a fixed decimal width. */
export function fixedDecimal(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
}

/** Formats an optional finite number with a fixed decimal width. */
export function optionalFixedDecimal(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? 'n/a' : fixedDecimal(value, digits)
}

/**
 * Formats bytes using binary units from bytes through gibibytes.
 * @param n Byte count to format.
 * @returns A localized-independent value and binary unit.
 */
export function fmtBytes(n: number): string {
  const u = ['B', 'KiB', 'MiB', 'GiB']

  let i = 0
  let x = n

  while (x >= 1024 && i < u.length - 1) {
    x /= 1024
    i++
  }

  return `${x.toFixed(i === 0 ? 0 : 2)} ${u[i]}`
}

/**
 * Formats a number with the `en-US` locale.
 * @param n Number to format.
 * @returns Locale-formatted numeric text.
 */
export function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Formats a local date as `YYYYMMDD-HHmmss` for stable artifact names.
 * @param d Date to format.
 * @returns Compact local-time timestamp.
 */
export function formatYmdHms(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

/**
 * Formats milliseconds as milliseconds, seconds, or minutes and seconds.
 * @param ms Duration in milliseconds.
 * @returns Human-readable duration, or `'n/a'` for non-finite input.
 */
export function msToHuman(ms: number): string {
  if (!isFinite(ms)) {
    return 'n/a'
  }

  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`
  }

  const s = ms / 1000

  if (s < 60) {
    return `${s.toFixed(2)}s`
  }

  const m = (s / 60) | 0
  const rest = s - m * 60

  return `${m}m ${rest.toFixed(1)}s`
}

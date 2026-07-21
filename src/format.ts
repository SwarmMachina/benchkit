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

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

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

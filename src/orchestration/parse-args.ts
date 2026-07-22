export type ArgHandler<T extends object> = (out: T, value: string | undefined) => boolean | void

export default function parseArgs<T extends object>(
  argv: string[],
  defaults: T,
  handlers: Record<string, ArgHandler<T>>
): T {
  const out = { ...defaults }

  for (let i = 2; i < argv.length; i++) {
    const name = argv[i]

    if (name === undefined) {
      continue
    }

    const handler = handlers[name]

    if (!handler) {
      continue
    }

    const value = handler(out, argv[i + 1]) !== false

    if (value) {
      i++
    }
  }

  return out
}

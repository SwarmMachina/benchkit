/**
 * Mutates parsed output for one recognized CLI argument.
 *
 * Return `false` when the argument does not consume the following token.
 */
export type ArgHandler<T extends object> = (out: T, value: string | undefined) => boolean | void

/** Parsing mode and starting position for the small CLI argument parser. */
export interface ParseArgsOptions {
  /**
   * Rejects unknown arguments and missing consumed values.
   * @default `false`
   */
  strict?: boolean

  /**
   * First argument index to inspect.
   * @default `0` in strict mode, otherwise `2`.
   */
  offset?: number
}

export default function parseArgs<T extends object>(
  argv: string[],
  defaults: T,
  handlers: Record<string, ArgHandler<T>>,
  options: ParseArgsOptions = {}
): T {
  const strict = options.strict ?? false
  const offset = options.offset ?? (strict ? 0 : 2)

  if (!Number.isSafeInteger(offset) || offset < 0 || offset > argv.length) {
    throw new RangeError('offset must be a safe integer within argv')
  }

  const out = { ...defaults }

  for (let i = offset; i < argv.length; i++) {
    const name = argv[i]

    if (name === undefined) {
      continue
    }

    const handler = handlers[name]

    if (!handler) {
      if (strict) {
        throw new TypeError(`unknown argument: ${name}`)
      }

      continue
    }

    const next = argv[i + 1]
    const consumesValue = handler(out, next) !== false

    if (strict && consumesValue && (next === undefined || next.startsWith('--'))) {
      throw new TypeError(`missing value for argument: ${name}`)
    }

    if (consumesValue) {
      i++
    }
  }

  return out
}

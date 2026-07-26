import net from 'node:net'
import { BenchkitError } from '../control/errors.js'
import { isPort } from '../control/value-guards.js'

/** Host and optional inclusive range used for TCP port selection. */
export interface GetFreePortOptions {
  /**
   * Local interface on which availability is tested.
   * @default `'127.0.0.1'`
   */
  host?: string

  /** Inclusive `[minimum, maximum]` port range. */
  range?: readonly [number, number]
}

async function listenOnce(host: string, port: number): Promise<number> {
  const server = net.createServer()

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host, port, exclusive: true }, () => resolve())
    })

    const address = server.address()

    if (!address || typeof address === 'string') {
      throw new BenchkitError('Port selector returned no TCP address', 'PORT_SELECTION_FAILED')
    }

    return address.port
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
    }
  }
}

/**
 * Selects a currently available TCP port by briefly binding the requested host.
 *
 * The returned port is not reserved after this function resolves; callers must
 * still handle a bind race when starting their server.
 * @param options Local host and optional inclusive search range.
 * @param options.host Local interface on which availability is tested.
 * @param options.range Optional inclusive minimum and maximum ports.
 * @returns An available port selected by the operating system or from the range.
 * @throws {TypeError} If `host` is empty or contains control characters.
 * @throws {RangeError} If the requested range is invalid.
 * @throws {BenchkitError} If no port in the range can be bound.
 */
export default async function getFreePort({ host = '127.0.0.1', range }: GetFreePortOptions = {}): Promise<number> {
  if (typeof host !== 'string' || host.length === 0 || /[\0\r\n]/u.test(host)) {
    throw new TypeError('host must be a non-empty string without control characters')
  }

  if (range === undefined) {
    return listenOnce(host, 0)
  }

  if (!Array.isArray(range) || range.length !== 2 || !isPort(range[0]) || !isPort(range[1]) || range[0] > range[1]) {
    throw new RangeError('range must contain two ordered valid ports')
  }

  const [minimum, maximum] = range
  const count = maximum - minimum + 1
  const offset = Math.floor(Math.random() * count)

  let lastError: unknown

  for (let index = 0; index < count; index++) {
    const port = minimum + ((offset + index) % count)

    try {
      return await listenOnce(host, port)
    } catch (error) {
      lastError = error
    }
  }

  throw new BenchkitError(`No free port in range ${minimum}-${maximum}`, 'PORT_RANGE_EXHAUSTED', undefined, {
    cause: lastError
  })
}

export { getFreePort }

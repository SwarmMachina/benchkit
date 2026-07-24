const HEADER_END = Buffer.from('\r\n\r\n')
const LINE_END = Buffer.from('\r\n')
const STATUS_LINE = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: |$)/u

type ParserState = 'headers' | 'fixed-body' | 'chunk-size' | 'chunk-data' | 'chunk-data-crlf' | 'trailers'

export interface Http1ResponseParserOptions {
  requestMethod: string
  maxHeaderBytes: number
}

export type Http1ResponseCallback = (statusCode: number) => void

export class Http1ResponseParser {
  readonly #requestMethod: string
  readonly #maxHeaderBytes: number

  #state: ParserState = 'headers'
  #pending = Buffer.alloc(0)
  #bodyRemaining = 0
  #chunkRemaining = 0
  #statusCode = 0
  #trailerBytes = 0

  constructor({ requestMethod, maxHeaderBytes }: Http1ResponseParserOptions) {
    this.#requestMethod = requestMethod
    this.#maxHeaderBytes = maxHeaderBytes
  }

  push(chunk: Buffer, onResponse: Http1ResponseCallback): void {
    const input = this.#pending.length ? Buffer.concat([this.#pending, chunk]) : chunk

    let offset = 0

    this.#pending = Buffer.alloc(0)

    while (offset < input.length) {
      if (this.#state === 'headers') {
        const headerEnd = input.indexOf(HEADER_END, offset)

        if (headerEnd === -1) {
          this.#retain(input.subarray(offset), 'response headers')

          return
        }

        if (headerEnd - offset > this.#maxHeaderBytes) {
          throw new Error(`response headers exceed ${this.#maxHeaderBytes} bytes`)
        }

        const framing = parseHeaders(input.subarray(offset, headerEnd), this.#requestMethod)

        offset = headerEnd + HEADER_END.length
        this.#statusCode = framing.statusCode

        if (framing.informational) {
          if (framing.statusCode === 101) {
            throw new Error('HTTP protocol upgrades are not supported')
          }

          continue
        }

        if (framing.bodyLength === 0) {
          this.#complete(onResponse)

          continue
        }

        if (framing.chunked) {
          this.#state = 'chunk-size'

          continue
        }

        if (framing.bodyLength === null) {
          throw new Error('close-delimited HTTP responses are not supported')
        }

        this.#bodyRemaining = framing.bodyLength
        this.#state = 'fixed-body'

        continue
      }

      if (this.#state === 'fixed-body') {
        const consumed = Math.min(this.#bodyRemaining, input.length - offset)

        offset += consumed
        this.#bodyRemaining -= consumed

        if (this.#bodyRemaining === 0) {
          this.#complete(onResponse)
        }

        continue
      }

      if (this.#state === 'chunk-size') {
        const lineEnd = input.indexOf(LINE_END, offset)

        if (lineEnd === -1) {
          this.#retain(input.subarray(offset), 'chunk size')

          return
        }

        const line = input.toString('latin1', offset, lineEnd)
        const extension = line.indexOf(';')
        const rawSize = (extension === -1 ? line : line.slice(0, extension)).trim()

        if (!/^[0-9A-Fa-f]+$/u.test(rawSize)) {
          throw new Error('invalid HTTP chunk size')
        }

        this.#chunkRemaining = Number.parseInt(rawSize, 16)

        if (!Number.isSafeInteger(this.#chunkRemaining)) {
          throw new Error('HTTP chunk size exceeds the safe integer range')
        }

        offset = lineEnd + LINE_END.length

        if (this.#chunkRemaining === 0) {
          this.#trailerBytes = 0
          this.#state = 'trailers'
        } else {
          this.#state = 'chunk-data'
        }

        continue
      }

      if (this.#state === 'chunk-data') {
        const consumed = Math.min(this.#chunkRemaining, input.length - offset)

        offset += consumed
        this.#chunkRemaining -= consumed

        if (this.#chunkRemaining === 0) {
          this.#state = 'chunk-data-crlf'
        }

        continue
      }

      if (this.#state === 'chunk-data-crlf') {
        if (input.length - offset < LINE_END.length) {
          this.#pending = Buffer.from(input.subarray(offset))

          return
        }

        if (input[offset] !== 13 || input[offset + 1] !== 10) {
          throw new Error('HTTP chunk data is not followed by CRLF')
        }

        offset += LINE_END.length
        this.#state = 'chunk-size'

        continue
      }

      const trailerEnd = input.indexOf(LINE_END, offset)

      if (trailerEnd === -1) {
        this.#retain(input.subarray(offset), 'response trailers')

        return
      }

      if (trailerEnd === offset) {
        offset += LINE_END.length
        this.#complete(onResponse)

        continue
      }

      this.#trailerBytes += trailerEnd - offset + LINE_END.length

      if (this.#trailerBytes > this.#maxHeaderBytes) {
        throw new Error(`response trailers exceed ${this.#maxHeaderBytes} bytes`)
      }

      offset = trailerEnd + LINE_END.length
    }
  }

  reset(): void {
    this.#state = 'headers'
    this.#pending = Buffer.alloc(0)
    this.#bodyRemaining = 0
    this.#chunkRemaining = 0
    this.#statusCode = 0
    this.#trailerBytes = 0
  }

  #complete(onResponse: Http1ResponseCallback): void {
    const statusCode = this.#statusCode

    this.#state = 'headers'
    this.#bodyRemaining = 0
    this.#chunkRemaining = 0
    this.#statusCode = 0
    this.#trailerBytes = 0
    onResponse(statusCode)
  }

  #retain(value: Buffer, label: string): void {
    if (value.length > this.#maxHeaderBytes) {
      throw new Error(`${label} exceed ${this.#maxHeaderBytes} bytes`)
    }

    this.#pending = Buffer.from(value)
  }
}

interface ResponseFraming {
  statusCode: number
  informational: boolean
  chunked: boolean
  bodyLength: number | null
}

function parseHeaders(buffer: Buffer, requestMethod: string): ResponseFraming {
  const lines = buffer.toString('latin1').split('\r\n')
  const statusMatch = STATUS_LINE.exec(lines[0] ?? '')

  if (!statusMatch) {
    throw new Error('invalid HTTP response status line')
  }

  const statusCode = Number(statusMatch[1])
  const contentLengths: string[] = []

  let transferEncoding: string | null = null

  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':')

    if (separator <= 0) {
      throw new Error('invalid HTTP response header')
    }

    const name = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (name === 'content-length') {
      contentLengths.push(...value.split(',').map((entry) => entry.trim()))
    } else if (name === 'transfer-encoding') {
      transferEncoding = value.toLowerCase()
    }
  }

  const informational = statusCode >= 100 && statusCode < 200
  const noBody = informational || requestMethod === 'HEAD' || statusCode === 204 || statusCode === 304
  const chunked =
    transferEncoding
      ?.split(',')
      .map((value) => value.trim())
      .at(-1) === 'chunked'

  if (transferEncoding !== null && !chunked) {
    throw new Error(`unsupported Transfer-Encoding: ${transferEncoding}`)
  }

  if (chunked && contentLengths.length) {
    throw new Error('response must not contain both Transfer-Encoding and Content-Length')
  }

  if (noBody) {
    return { statusCode, informational, chunked: false, bodyLength: 0 }
  }

  if (chunked) {
    return { statusCode, informational, chunked: true, bodyLength: null }
  }

  if (contentLengths.length === 0) {
    return { statusCode, informational, chunked: false, bodyLength: null }
  }

  if (new Set(contentLengths).size !== 1 || !/^(?:0|[1-9][0-9]*)$/u.test(contentLengths[0] ?? '')) {
    throw new Error('invalid or conflicting Content-Length response headers')
  }

  const bodyLength = Number(contentLengths[0])

  if (!Number.isSafeInteger(bodyLength)) {
    throw new Error('Content-Length exceeds the safe integer range')
  }

  return { statusCode, informational, chunked: false, bodyLength }
}

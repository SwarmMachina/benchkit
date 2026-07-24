const HEADER_END = Buffer.from('\r\n\r\n')
const LINE_END = Buffer.from('\r\n')
const CONTENT_LENGTH = 'content-length'
const TRANSFER_ENCODING = 'transfer-encoding'
const CHUNKED = 'chunked'

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
  readonly #framing: ResponseFraming = {
    statusCode: 0,
    informational: false,
    chunked: false,
    bodyLength: null
  }

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

        parseHeaders(input.subarray(offset, headerEnd), this.#requestMethod, this.#framing)

        offset = headerEnd + HEADER_END.length
        this.#statusCode = this.#framing.statusCode

        if (this.#framing.informational) {
          if (this.#framing.statusCode === 101) {
            throw new Error('HTTP protocol upgrades are not supported')
          }

          continue
        }

        if (this.#framing.bodyLength === 0) {
          this.#complete(onResponse)

          continue
        }

        if (this.#framing.chunked) {
          this.#state = 'chunk-size'

          continue
        }

        if (this.#framing.bodyLength === null) {
          throw new Error('close-delimited HTTP responses are not supported')
        }

        this.#bodyRemaining = this.#framing.bodyLength
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

        this.#chunkRemaining = parseChunkSize(input, offset, lineEnd)

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

function parseHeaders(buffer: Buffer, requestMethod: string, framing: ResponseFraming): void {
  const foundStatusLineEnd = buffer.indexOf(LINE_END)
  const statusLineEnd = foundStatusLineEnd === -1 ? buffer.length : foundStatusLineEnd

  if (
    statusLineEnd < 12 ||
    buffer[0] !== 72 ||
    buffer[1] !== 84 ||
    buffer[2] !== 84 ||
    buffer[3] !== 80 ||
    buffer[4] !== 47 ||
    buffer[5] !== 49 ||
    buffer[6] !== 46 ||
    (buffer[7] !== 48 && buffer[7] !== 49) ||
    buffer[8] !== 32 ||
    !isDigit(buffer[9]) ||
    !isDigit(buffer[10]) ||
    !isDigit(buffer[11]) ||
    (statusLineEnd > 12 && buffer[12] !== 32)
  ) {
    throw new Error('invalid HTTP response status line')
  }

  const statusCode = (buffer[9] - 48) * 100 + (buffer[10] - 48) * 10 + (buffer[11] - 48)

  if (statusCode < 100 || statusCode > 599) {
    throw new Error('invalid HTTP response status line')
  }

  let contentLength: number | null = null
  let hasContentLength = false
  let hasTransferEncoding = false
  let chunked = false
  let offset = foundStatusLineEnd === -1 ? buffer.length : statusLineEnd + LINE_END.length

  while (offset < buffer.length) {
    const foundLineEnd = buffer.indexOf(LINE_END, offset)
    const lineEnd = foundLineEnd === -1 ? buffer.length : foundLineEnd
    const separator = buffer.indexOf(58, offset)

    if (separator <= offset || separator >= lineEnd) {
      throw new Error('invalid HTTP response header')
    }

    let nameStart = offset
    let nameEnd = separator
    let valueStart = separator + 1
    let valueEnd = lineEnd

    while (nameStart < nameEnd && isOptionalWhitespace(buffer[nameStart])) {
      nameStart++
    }

    while (nameEnd > nameStart && isOptionalWhitespace(buffer[nameEnd - 1])) {
      nameEnd--
    }

    while (valueStart < valueEnd && isOptionalWhitespace(buffer[valueStart])) {
      valueStart++
    }

    while (valueEnd > valueStart && isOptionalWhitespace(buffer[valueEnd - 1])) {
      valueEnd--
    }

    if (asciiEqualsIgnoreCase(buffer, nameStart, nameEnd, CONTENT_LENGTH)) {
      contentLength = parseContentLength(buffer, valueStart, valueEnd, contentLength)
      hasContentLength = true
    } else if (asciiEqualsIgnoreCase(buffer, nameStart, nameEnd, TRANSFER_ENCODING)) {
      hasTransferEncoding = true
      chunked = lastTokenEquals(buffer, valueStart, valueEnd, CHUNKED)
    }

    offset = lineEnd + LINE_END.length
  }

  const informational = statusCode >= 100 && statusCode < 200
  const noBody = informational || requestMethod === 'HEAD' || statusCode === 204 || statusCode === 304

  if (hasTransferEncoding && !chunked) {
    throw new Error('unsupported Transfer-Encoding')
  }

  if (chunked && hasContentLength) {
    throw new Error('response must not contain both Transfer-Encoding and Content-Length')
  }

  framing.statusCode = statusCode
  framing.informational = informational
  framing.chunked = false
  framing.bodyLength = null

  if (noBody) {
    framing.bodyLength = 0

    return
  }

  if (chunked) {
    framing.chunked = true

    return
  }

  if (!hasContentLength) {
    return
  }

  framing.bodyLength = contentLength
}

function parseContentLength(buffer: Buffer, start: number, end: number, previous: number | null): number {
  let value = previous
  let offset = start

  while (offset <= end) {
    const comma = buffer.indexOf(44, offset)
    const rawEnd = comma === -1 || comma > end ? end : comma

    let partStart = offset
    let partEnd = rawEnd

    while (partStart < partEnd && isOptionalWhitespace(buffer[partStart])) {
      partStart++
    }

    while (partEnd > partStart && isOptionalWhitespace(buffer[partEnd - 1])) {
      partEnd--
    }

    if (partStart === partEnd || (partEnd - partStart > 1 && buffer[partStart] === 48)) {
      throw new Error('invalid or conflicting Content-Length response headers')
    }

    let parsed = 0

    for (let index = partStart; index < partEnd; index++) {
      const byte = buffer[index]

      if (!isDigit(byte) || parsed > (Number.MAX_SAFE_INTEGER - (byte - 48)) / 10) {
        throw new Error('invalid or conflicting Content-Length response headers')
      }

      parsed = parsed * 10 + (byte - 48)
    }

    if (value !== null && value !== parsed) {
      throw new Error('invalid or conflicting Content-Length response headers')
    }

    value = parsed

    if (comma === -1 || comma >= end) {
      break
    }

    offset = comma + 1
  }

  if (value === null) {
    throw new Error('invalid or conflicting Content-Length response headers')
  }

  return value
}

function lastTokenEquals(buffer: Buffer, start: number, end: number, expected: string): boolean {
  const comma = buffer.lastIndexOf(44, end - 1)

  let tokenStart = comma >= start ? comma + 1 : start
  let tokenEnd = end

  while (tokenStart < tokenEnd && isOptionalWhitespace(buffer[tokenStart])) {
    tokenStart++
  }

  while (tokenEnd > tokenStart && isOptionalWhitespace(buffer[tokenEnd - 1])) {
    tokenEnd--
  }

  return asciiEqualsIgnoreCase(buffer, tokenStart, tokenEnd, expected)
}

function asciiEqualsIgnoreCase(buffer: Buffer, start: number, end: number, expected: string): boolean {
  if (end - start !== expected.length) {
    return false
  }

  for (let index = 0; index < expected.length; index++) {
    const byte = buffer[start + index]

    if (byte === undefined) {
      return false
    }

    const normalized = byte >= 65 && byte <= 90 ? byte + 32 : byte

    if (normalized !== expected.charCodeAt(index)) {
      return false
    }
  }

  return true
}

function parseChunkSize(buffer: Buffer, start: number, end: number): number {
  const extension = buffer.indexOf(59, start)

  let sizeStart = start
  let sizeEnd = extension === -1 || extension > end ? end : extension

  while (sizeStart < sizeEnd && isOptionalWhitespace(buffer[sizeStart])) {
    sizeStart++
  }

  while (sizeEnd > sizeStart && isOptionalWhitespace(buffer[sizeEnd - 1])) {
    sizeEnd--
  }

  if (sizeStart === sizeEnd) {
    throw new Error('invalid HTTP chunk size')
  }

  let size = 0

  for (let index = sizeStart; index < sizeEnd; index++) {
    const digit = hexDigit(buffer[index])

    if (digit === -1) {
      throw new Error('invalid HTTP chunk size')
    }

    if (size > (Number.MAX_SAFE_INTEGER - digit) / 16) {
      throw new Error('HTTP chunk size exceeds the safe integer range')
    }

    size = size * 16 + digit
  }

  return size
}

function isDigit(value: number | undefined): value is number {
  return value !== undefined && value >= 48 && value <= 57
}

function isOptionalWhitespace(value: number | undefined): boolean {
  return value === 32 || value === 9
}

function hexDigit(value: number | undefined): number {
  if (value === undefined) {
    return -1
  }

  if (value >= 48 && value <= 57) {
    return value - 48
  }

  if (value >= 65 && value <= 70) {
    return value - 55
  }

  if (value >= 97 && value <= 102) {
    return value - 87
  }

  return -1
}

import { ProtocolError } from './errors.js'

/** Callbacks and frame limit for an incremental NDJSON decoder. */
export interface NdjsonDecoderOptions {
  /** Receives each successfully parsed JSON value. */
  onMessage: (message: unknown) => void

  /** Receives the first terminal decoding error. */
  onError: (error: ProtocolError) => void

  /**
   * Maximum UTF-8 bytes in one line-delimited frame.
   * @default `1_048_576`
   */
  maxLineBytes?: number
}

export function encodeNdjson(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

/** Incremental, size-bounded decoder for newline-delimited JSON streams. */
export class NdjsonDecoder {
  readonly #onMessage: NdjsonDecoderOptions['onMessage']
  readonly #onError: NdjsonDecoderOptions['onError']
  readonly #maxLineBytes: number
  #buffered = ''
  #failed = false

  constructor({ onMessage, onError, maxLineBytes = 1024 * 1024 }: NdjsonDecoderOptions) {
    this.#onMessage = onMessage
    this.#onError = onError
    this.#maxLineBytes = maxLineBytes
  }

  /**
   * Appends a UTF-8 chunk and synchronously emits every complete frame.
   *
   * Calls after a decoding failure are ignored.
   */
  push(chunk: string | Buffer): void {
    if (this.#failed) {
      return
    }

    this.#buffered += chunk.toString()

    if (Buffer.byteLength(this.#buffered) > this.#maxLineBytes && !this.#buffered.includes('\n')) {
      this.#fail(new ProtocolError(`NDJSON frame exceeds ${this.#maxLineBytes} bytes`))

      return
    }

    let newline = this.#buffered.indexOf('\n')

    while (newline !== -1 && !this.#failed) {
      const line = this.#buffered.slice(0, newline).replace(/\r$/, '')

      this.#buffered = this.#buffered.slice(newline + 1)

      if (Buffer.byteLength(line) > this.#maxLineBytes) {
        this.#fail(new ProtocolError(`NDJSON frame exceeds ${this.#maxLineBytes} bytes`))

        return
      }

      this.#parseLine(line)
      newline = this.#buffered.indexOf('\n')
    }

    if (!this.#failed && Buffer.byteLength(this.#buffered) > this.#maxLineBytes) {
      this.#fail(new ProtocolError(`NDJSON frame exceeds ${this.#maxLineBytes} bytes`))
    }
  }

  /**
   * Completes the stream.
   *
   * A non-whitespace partial frame is reported as a protocol error.
   */
  end(): void {
    if (!this.#failed && this.#buffered.trim() !== '') {
      this.#fail(new ProtocolError('NDJSON control stream ended with a partial frame'))
    }

    this.#buffered = ''
  }

  #fail(error: ProtocolError): void {
    if (!this.#failed) {
      this.#failed = true
      this.#buffered = ''
      this.#onError(error)
    }
  }

  #parseLine(line: string): void {
    if (line.trim() === '') {
      return
    }

    try {
      this.#onMessage(JSON.parse(line))
    } catch (cause) {
      this.#fail(new ProtocolError('Invalid JSON in NDJSON control stream', { line }, { cause }))
    }
  }
}

import crypto from 'node:crypto'
import http, { type IncomingMessage } from 'node:http'
import { type Duplex } from 'node:stream'

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

interface WebSocketFrame {
  consumed: number
  opcode: number
  payload: Buffer
}

export class WebSocketEchoServer {
  readonly #server: http.Server
  readonly #sockets = new Set<Duplex>()
  readonly #delayMs: number

  #connectionsOpened = 0
  #messagesReceived = 0

  constructor({ delayMs = 0 }: { delayMs?: number } = {}) {
    this.#delayMs = delayMs
    this.#server = http.createServer()
    this.#server.on('upgrade', this.#onUpgrade)
  }

  get connectionsOpened(): number {
    return this.#connectionsOpened
  }

  get messagesReceived(): number {
    return this.#messagesReceived
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.#server.once('error', reject)
      this.#server.listen(0, '127.0.0.1', () => {
        this.#server.off('error', reject)

        const address = this.#server.address()

        if (!address || typeof address === 'string') {
          reject(new Error('WebSocket test server did not expose a TCP port'))

          return
        }

        resolve(address.port)
      })
    })
  }

  close(): Promise<void> {
    for (const socket of this.#sockets) {
      socket.destroy()
    }

    return new Promise((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  readonly #onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const key = request.headers['sec-websocket-key']

    if (typeof key !== 'string') {
      socket.destroy()

      return
    }

    const accept = crypto.createHash('sha1').update(`${key}${WEBSOCKET_GUID}`).digest('base64')

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        ''
      ].join('\r\n')
    )

    this.#connectionsOpened++
    this.#sockets.add(socket)

    let buffered = head

    const consume = (chunk: Buffer): void => {
      buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk])

      while (true) {
        const frame = parseClientFrame(buffered)

        if (!frame) {
          return
        }

        buffered = buffered.subarray(frame.consumed)

        if (frame.opcode === 0x8) {
          socket.write(encodeServerFrame(0x8, frame.payload))
          socket.end()

          return
        }

        if (frame.opcode === 0x9) {
          socket.write(encodeServerFrame(0xa, frame.payload))

          continue
        }

        if (frame.opcode !== 0x1 && frame.opcode !== 0x2) {
          socket.destroy()

          return
        }

        this.#messagesReceived++

        const echo = (): void => {
          if (!socket.destroyed) {
            socket.write(encodeServerFrame(frame.opcode, frame.payload))
          }
        }

        if (this.#delayMs > 0) {
          setTimeout(echo, this.#delayMs)
        } else {
          echo()
        }
      }
    }

    socket.on('data', consume)
    socket.on('error', () => this.#sockets.delete(socket))
    socket.once('close', () => this.#sockets.delete(socket))

    if (head.length > 0) {
      consume(Buffer.alloc(0))
    }
  }
}

function parseClientFrame(buffer: Buffer): WebSocketFrame | null {
  if (buffer.length < 2) {
    return null
  }

  const first = buffer[0] ?? 0
  const second = buffer[1] ?? 0

  if ((first & 0x80) === 0 || (second & 0x80) === 0) {
    throw new Error('test server only accepts final masked client frames')
  }

  let payloadLength = second & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < 4) {
      return null
    }

    payloadLength = buffer.readUInt16BE(2)
    offset = 4
  } else if (payloadLength === 127) {
    if (buffer.length < 10) {
      return null
    }

    const wideLength = buffer.readBigUInt64BE(2)

    if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('test WebSocket frame is too large')
    }

    payloadLength = Number(wideLength)
    offset = 10
  }

  const consumed = offset + 4 + payloadLength

  if (buffer.length < consumed) {
    return null
  }

  const mask = buffer.subarray(offset, offset + 4)
  const encoded = buffer.subarray(offset + 4, consumed)
  const payload = Buffer.allocUnsafe(payloadLength)

  for (let index = 0; index < payloadLength; index++) {
    payload[index] = (encoded[index] ?? 0) ^ (mask[index % 4] ?? 0)
  }

  return {
    consumed,
    opcode: first & 0x0f,
    payload
  }
}

function encodeServerFrame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer

  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length])
  } else if (payload.length <= 0xffff) {
    header = Buffer.allocUnsafe(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }

  return Buffer.concat([header, payload])
}

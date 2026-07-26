import assert from 'node:assert/strict'
import test from 'node:test'
import { TimestampQueue } from '../../../../dist/load/shared/timestamp-queue.js'

test('TimestampQueue preserves FIFO order across ring-buffer wraparound', () => {
  const queue = new TimestampQueue(2)

  queue.push(1)
  queue.push(2)

  assert.equal(queue.shift(), 1)

  queue.push(3)

  assert.equal(queue.size, 2)
  assert.equal(queue.peekTimeoutStart(), 2)
  assert.equal(queue.shift(), 2)
  assert.equal(queue.shift(), 3)
  assert.equal(queue.shift(), null)
})

test('TimestampQueue tracks an independent timeout clock when requested', () => {
  const queue = new TimestampQueue(2, { trackTimeouts: true })

  queue.push(10, 20)
  queue.push(11, 21)

  assert.equal(queue.peekTimeoutStart(), 20)
  assert.equal(queue.shift(), 10)
  assert.equal(queue.peekTimeoutStart(), 21)

  queue.clear()

  assert.equal(queue.size, 0)
  assert.equal(queue.peekTimeoutStart(), null)
})

test('TimestampQueue rejects writes beyond its fixed capacity', () => {
  const queue = new TimestampQueue(1)

  queue.push(1)

  assert.throws(() => queue.push(2), /timestamp queue overflow/u)
})

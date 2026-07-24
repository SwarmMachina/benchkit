import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'

import { BenchkitError, getFreePort } from '@swarmmachina/benchkit'
import getFreePortDefault from '@swarmmachina/benchkit/get-free-port'

test('getFreePort returns an ephemeral IPv4 port', async () => {
  const port = await getFreePort()

  assert.ok(Number.isInteger(port))
  assert.ok(port >= 1 && port <= 65_535)
})

test('getFreePort selects an available port from a range', async () => {
  const port = await getFreePortDefault()

  assert.equal(await getFreePort({ range: [port, port] }), port)
})

test('getFreePort reports an exhausted range', async (context) => {
  const server = net.createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => resolve())
  })
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
  )

  const address = server.address()

  assert.ok(address && typeof address === 'object')
  await assert.rejects(
    getFreePort({ range: [address.port, address.port] }),
    (error: unknown) => error instanceof BenchkitError && error.code === 'PORT_RANGE_EXHAUSTED'
  )
})

test('getFreePort validates host and range options', async () => {
  await assert.rejects(getFreePort({ host: '' }), TypeError)
  await assert.rejects(getFreePort({ range: [0, 65_536] }), RangeError)
  await assert.rejects(getFreePort({ range: [2, 1] }), RangeError)
})

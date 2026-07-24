import fs from 'node:fs/promises'
import net from 'node:net'
import { TargetRuntime } from '../../../dist/target/index.js'

/**
 *
 * @param name
 * @param fallback
 */
/**
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function option(name, fallback) {
  const index = process.argv.indexOf(name)

  return index === -1 ? fallback : process.argv[index + 1]
}

const port = Number(option('--port', '0'))
const host = option('--host', '127.0.0.1')
const readyDelayMs = Number(option('--ready-delay-ms', '0'))
const exitAfterReadyMs = Number(option('--exit-after-ready-ms', '0'))
const logBurstBytes = Number(option('--log-burst-bytes', '0'))
const hangShutdown = process.argv.includes('--hang-shutdown')
const server = net.createServer((socket) => {
  socket.on('error', () => {})
  socket.end('ok\n')
})
const runtime = new TargetRuntime({ metrics: true })

if (process.argv.includes('--log-interval')) {
  setInterval(() => process.stderr.write('fixture heartbeat\n'), 10).unref()
}

if (process.env.BENCHKIT_FIXTURE_PID_FILE) {
  await fs.writeFile(process.env.BENCHKIT_FIXTURE_PID_FILE, String(process.pid))
}

if (logBurstBytes > 0) {
  process.stderr.write('x'.repeat(logBurstBytes))
}

if (process.argv.includes('--fail-before-ready')) {
  process.stderr.write('fixture startup failure\n')
  process.exit(17)
}

runtime.registerShutdown(async () => {
  if (hangShutdown) {
    await new Promise(() => {})
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
})

server.listen({ port, host }, () => {
  const address = server.address()

  setTimeout(() => {
    runtime.ready({ port: address.port })

    if (exitAfterReadyMs > 0) {
      setTimeout(() => process.exit(23), exitAfterReadyMs)
    }
  }, readyDelayMs)
})

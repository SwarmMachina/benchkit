import type { ChildProcess } from 'node:child_process'

interface PromiseResolvers<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

interface PromiseConstructorWithResolvers {
  withResolvers<T>(): PromiseResolvers<T>
}

export default function waitForMessage(
  p: ChildProcess,
  predicate: (message: unknown) => boolean,
  timeoutMs = 30_000
): Promise<unknown> {
  const { promise, resolve, reject } = (Promise as unknown as PromiseConstructorWithResolvers).withResolvers<unknown>()
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    cleanup()
    reject(new Error(`child exited before IPC message (code=${code ?? 'null'}, signal=${signal ?? 'null'})`))
  }
  const onError = (err: Error) => {
    cleanup()
    reject(err)
  }
  const onMessage = (msg: unknown) => {
    try {
      if (predicate(msg)) {
        cleanup()
        resolve(msg)
      }
    } catch (e) {
      cleanup()
      reject(e)
    }
  }
  const t = setTimeout(() => {
    cleanup()
    reject(new Error(`timeout waiting for IPC message after ${timeoutMs}ms`))
  }, timeoutMs)
  const cleanup = () => {
    clearTimeout(t)
    p.off('exit', onExit)
    p.off('error', onError)
    p.off('message', onMessage)
  }

  p.once('exit', onExit)
  p.once('error', onError)
  p.on('message', onMessage)

  return promise
}

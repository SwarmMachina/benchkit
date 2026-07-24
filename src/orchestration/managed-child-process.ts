import { execFile, type ChildProcess } from 'node:child_process'
import { TimeoutError } from '../control/errors.js'

export interface ChildExitResult {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface TerminateChildProcessResult {
  exit: ChildExitResult
  escalated: boolean
  alreadyExited: boolean
}

type ExecuteFile = typeof execFile
type KillProcess = (pid: number, signal: NodeJS.Signals) => true

export interface TerminateChildProcessOptions {
  gracefulSignal?: NodeJS.Signals | false
  forceSignal?: NodeJS.Signals
  graceMs?: number
  killMs?: number
  killTree?: boolean
  platform?: NodeJS.Platform
  executeFile?: ExecuteFile
  killProcess?: KillProcess
}

export async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<ChildExitResult | null> {
  validateTimeout(timeoutMs, 'timeoutMs')
  const exited = currentExit(child)

  if (exited) {
    return exited
  }

  return new Promise<ChildExitResult | null>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const settle = (value: ChildExitResult | null, error?: Error) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      if (error) {
        reject(error)
      } else {
        resolve(value)
      }
    }
    const onError = (error: Error) => settle(null, error)
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => settle({ code, signal })
    const timer = setTimeout(() => settle(null), timeoutMs)

    child.once('error', onError)
    child.once('exit', onExit)
  })
}

export async function terminateWindowsProcessTree(
  pid: number,
  timeoutMs: number,
  execute: ExecuteFile = execFile
): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new TypeError('pid must be a positive safe integer')
  }

  validateTimeout(timeoutMs, 'timeoutMs', false)

  await new Promise<void>((resolve, reject) => {
    execute(
      'taskkill',
      ['/pid', String(pid), '/T', '/F'],
      { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: timeoutMs, windowsHide: true },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message, { cause: error }))
        } else {
          resolve()
        }
      }
    )
  })
}

export async function terminateChildProcess(
  child: ChildProcess,
  {
    gracefulSignal = 'SIGTERM',
    forceSignal = 'SIGKILL',
    graceMs = 5_000,
    killMs = 1_000,
    killTree = false,
    platform = process.platform,
    executeFile: execute = execFile,
    killProcess = process.kill
  }: TerminateChildProcessOptions = {}
): Promise<TerminateChildProcessResult> {
  validateTimeout(graceMs, 'graceMs')
  validateTimeout(killMs, 'killMs', false)
  const existing = currentExit(child)

  if (existing) {
    return { exit: existing, escalated: false, alreadyExited: true }
  }

  if (gracefulSignal !== false) {
    try {
      child.kill(gracefulSignal)
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error
      }
    }

    const gracefulExit = await waitForChildExit(child, graceMs)

    if (gracefulExit) {
      return { exit: gracefulExit, escalated: false, alreadyExited: false }
    }
  }

  const pid = child.pid

  if (killTree && pid !== undefined && platform === 'win32') {
    await terminateWindowsProcessTree(pid, killMs, execute)
  } else if (killTree && pid !== undefined) {
    try {
      killProcess(-pid, forceSignal)
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error
      }
    }
  } else {
    try {
      child.kill(forceSignal)
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error
      }
    }
  }

  const forcedExit = await waitForChildExit(child, killMs)

  if (!forcedExit) {
    throw new TimeoutError('child process termination', killMs)
  }

  return { exit: forcedExit, escalated: true, alreadyExited: false }
}

function currentExit(child: ChildProcess): ChildExitResult | null {
  if (child.exitCode === null && child.signalCode === null) {
    return null
  }

  if (child.exitCode === undefined && child.signalCode === undefined) {
    return null
  }

  return {
    code: child.exitCode ?? null,
    signal: child.signalCode ?? null
  }
}

function validateTimeout(value: number, name: string, allowZero = true): void {
  if (!Number.isFinite(value) || value < (allowZero ? 0 : Number.MIN_VALUE)) {
    throw new TypeError(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} finite number`)
  }
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ESRCH'
}

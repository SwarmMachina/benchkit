import { execFile, type ChildProcess } from 'node:child_process'
import { TimeoutError } from '../control/errors.js'
import { requireNonNegativeNumber, requirePositiveInteger, requirePositiveNumber } from '../validation/value-parsers.js'

/** Exit code and terminating signal observed from a child process. */
export interface ChildExitResult {
  /** Numeric process exit code, or `null` when terminated by a signal. */
  code: number | null

  /** Terminating signal, or `null` after a normal exit. */
  signal: NodeJS.Signals | null
}

/** Outcome of a bounded graceful-then-forced child termination. */
export interface TerminateChildProcessResult {
  /** Final child exit state. */
  exit: ChildExitResult

  /** Whether termination advanced to the force phase. */
  escalated: boolean

  /** Whether the child had already exited before termination began. */
  alreadyExited: boolean
}

type ExecuteFile = typeof execFile
type KillProcess = (pid: number, signal: NodeJS.Signals) => true

/** Signals, deadlines, and injectable platform operations for child termination. */
export interface TerminateChildProcessOptions {
  /**
   * First signal sent to the child, or `false` to skip graceful termination.
   * @default `'SIGTERM'`
   */
  gracefulSignal?: NodeJS.Signals | false

  /**
   * Signal used after the graceful deadline.
   * @default `'SIGKILL'`
   */
  forceSignal?: NodeJS.Signals

  /**
   * Graceful-exit deadline in milliseconds.
   * @default `5_000`
   */
  graceMs?: number

  /**
   * Forced-exit deadline in milliseconds.
   * @default `1_000`
   */
  killMs?: number

  /**
   * Terminates the process group or Windows process tree.
   * @default `false`
   */
  killTree?: boolean

  /**
   * Platform used to select tree-termination behavior.
   * @default `process.platform`
   */
  platform?: NodeJS.Platform

  /** Injectable `execFile` implementation used for Windows `taskkill`. */
  executeFile?: ExecuteFile

  /** Injectable process-group kill implementation. */
  killProcess?: KillProcess
}

export async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<ChildExitResult | null> {
  requireNonNegativeNumber(timeoutMs, 'timeoutMs')
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
  requirePositiveInteger(pid, 'pid')
  requirePositiveNumber(timeoutMs, 'timeoutMs')

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
  requireNonNegativeNumber(graceMs, 'graceMs')
  requirePositiveNumber(killMs, 'killMs')
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

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ESRCH'
}

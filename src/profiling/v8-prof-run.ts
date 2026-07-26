import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

interface LogCandidate {
  f: string
  mtimeMs: number
  size: number
}

/** Paths produced after converting a V8 log with `node --prof-process`. */
export interface ProcessedV8Profile {
  /** Path to the original isolate V8 log. */
  logPath: string

  /** Path to the processed text report. */
  processedPath: string
}

/**
 * Selects the newest V8 isolate log in a directory.
 * @param dir Directory containing `isolate-*-v8.log` files.
 * @returns The newest matching basename, or `null` when none exist.
 */
export async function pickNewestLog(dir: string): Promise<string | null> {
  const items = await fs.readdir(dir)
  const logs = items.filter((f) => f.startsWith('isolate-') && f.endsWith('-v8.log'))

  if (!logs.length) {
    return null
  }

  let best: LogCandidate | null = null

  for (const f of logs) {
    const st = await fs.stat(path.join(dir, f))

    if (!best || st.mtimeMs > best.mtimeMs) {
      best = { f, mtimeMs: st.mtimeMs, size: st.size }
    }
  }

  return best?.f || null
}

/**
 * Converts the newest isolate log with the current Node.js `--prof-process`.
 * @param profileDir Directory containing the raw isolate log.
 * @returns Raw and processed paths, or `null` when no log exists.
 * @throws {Error} If the profiler subprocess cannot start or exits unsuccessfully.
 */
export async function processV8Profile(profileDir: string): Promise<ProcessedV8Profile | null> {
  const logName = await pickNewestLog(profileDir)

  if (!logName) {
    return null
  }

  const logPath = path.join(profileDir, logName)
  const outPath = path.join(profileDir, 'profile.txt')

  await new Promise<boolean>((resolve, reject) => {
    const p = spawn(process.execPath, ['--no-warnings', '--prof-process', logPath], {
      stdio: ['ignore', 'pipe', 'inherit']
    })
    const out = createWriteStream(outPath)

    p.stdout.pipe(out)

    p.on('error', reject)
    p.on('exit', (code) => {
      out.end()

      if (code === 0) {
        resolve(true)
      } else {
        reject(new Error(`prof-process failed with code ${code}`))
      }
    })
  })

  return { logPath, processedPath: outPath }
}

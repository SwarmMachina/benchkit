import { spawn, type SpawnOptions } from 'node:child_process'

export default function runChild(args: string[], opts: SpawnOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', ...opts })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`node ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

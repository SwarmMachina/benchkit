import fs from 'node:fs/promises'

export default async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true })

  return dir
}

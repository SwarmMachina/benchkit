import fs from 'node:fs/promises'

/**
 * Ensures that a directory and all missing parents exist.
 * @param dir Directory path to create.
 * @returns The unchanged input path after creation completes.
 */
export default async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true })

  return dir
}

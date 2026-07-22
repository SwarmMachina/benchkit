import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

interface ExportTarget {
  types: string
  import: string
}

test('every public export resolves to emitted runtime and declaration files', async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
    name: string
    exports: Record<string, ExportTarget>
  }

  for (const [subpath, target] of Object.entries(packageJson.exports)) {
    await fs.access(new URL(`../../${target.import}`, import.meta.url))
    await fs.access(new URL(`../../${target.types}`, import.meta.url))

    const specifier = subpath === '.' ? packageJson.name : `${packageJson.name}/${subpath.slice(2)}`
    const exports = (await import(specifier)) as object

    assert.equal(typeof exports, 'object', specifier)
  }
})

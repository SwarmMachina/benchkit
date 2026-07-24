import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'benchkit-packed-types-'))

/**
 * @param {string} file
 * @param {unknown} value
 */
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

try {
  const artifacts = path.join(temporary, 'artifacts')
  const consumer = path.join(temporary, 'consumer')

  fs.mkdirSync(artifacts)
  fs.mkdirSync(consumer)

  const packed = JSON.parse(
    execFileSync('pnpm', ['pack', '--json', '--pack-destination', artifacts], {
      cwd: root,
      encoding: 'utf8'
    })
  )
  const tarball = Array.isArray(packed) ? packed[0]?.filename : packed.filename

  assert.equal(typeof tarball, 'string', 'pnpm pack did not return a tarball path')

  writeJson(path.join(consumer, 'package.json'), {
    private: true,
    type: 'module',
    dependencies: {
      '@swarmmachina/benchkit': `file:${tarball}`
    }
  })
  fs.writeFileSync(
    path.join(consumer, 'consumer.ts'),
    [
      "import { createTargetProvider, type TargetSession } from '@swarmmachina/benchkit'",
      "import { createBoundedLatencyRecorder } from '@swarmmachina/benchkit/measurement'",
      "import { createTargetRuntime } from '@swarmmachina/benchkit/target'",
      "import getFreePort from '@swarmmachina/benchkit/get-free-port'",
      '',
      "const provider = createTargetProvider({ mode: 'local' })",
      'const session = undefined as TargetSession | undefined',
      '',
      'void [provider, session, createBoundedLatencyRecorder(), createTargetRuntime(), getFreePort]',
      ''
    ].join('\n')
  )

  execFileSync('pnpm', ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: consumer,
    stdio: 'inherit'
  })

  const installedPackage = path.join(consumer, 'node_modules', '@swarmmachina', 'benchkit')
  const rootDeclarations = fs.readFileSync(path.join(installedPackage, 'dist/types.d.ts'), 'utf8')
  const http1Declarations = fs.readFileSync(path.join(installedPackage, 'dist/load/http1/types.d.ts'), 'utf8')

  assert.match(rootDeclarations, /export \* from '\.\/index\.js'/)
  assert.match(http1Declarations, /Options accepted by.*runHttp1Load/s)
  assert.match(http1Declarations, /@default `10_000`/)
  assert.match(http1Declarations, /Fixed-rate arrivals dropped because no pipeline capacity was available/)

  const shared = {
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: ['node'],
    typeRoots: [path.join(root, 'node_modules/@types')]
  }
  const modes = [
    { name: 'nodenext', module: 'NodeNext', moduleResolution: 'NodeNext' },
    { name: 'bundler', module: 'ESNext', moduleResolution: 'Bundler' }
  ]
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const containingFile = path.join(consumer, 'consumer.ts')

  for (const mode of modes) {
    const config = path.join(consumer, `tsconfig.${mode.name}.json`)
    const compilerOptions = { ...shared, module: mode.module, moduleResolution: mode.moduleResolution }

    writeJson(config, {
      compilerOptions,
      include: ['consumer.ts']
    })
    execFileSync(path.join(root, 'node_modules/.bin/tsc'), ['--project', config, '--pretty', 'false'], {
      cwd: consumer,
      stdio: 'inherit'
    })

    const resolvedOptions = ts.convertCompilerOptionsFromJson(compilerOptions, consumer).options

    for (const [subpath, target] of Object.entries(packageJson.exports)) {
      const specifier = subpath === '.' ? packageJson.name : `${packageJson.name}/${subpath.slice(2)}`
      const resolved = ts.resolveModuleName(specifier, containingFile, resolvedOptions, ts.sys).resolvedModule
      const expected = path.join(consumer, 'node_modules', packageJson.name, target.types)

      assert.ok(resolved, `${mode.name}: ${specifier} did not resolve`)
      assert.equal(
        fs.realpathSync(resolved.resolvedFileName),
        fs.realpathSync(expected),
        `${mode.name}: ${specifier} resolved to an unexpected declaration`
      )
    }
  }

  console.log('packed consumer declarations: NodeNext + Bundler resolution ok')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}

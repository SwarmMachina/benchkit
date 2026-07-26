import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { snapshotEnvironment, type EnvironmentSnapshot } from '../control/environment.js'
import { isRecord } from '../validation/predicates.js'
import { requireNonEmptyString } from '../validation/value-parsers.js'

/** Schema identifier written to every benchmark artifact. */
export const BENCHMARK_ARTIFACT_SCHEMA_VERSION = 'benchmark-run/v1' as const

/** Versioned, serializable benchmark artifact. */
export interface BenchmarkArtifact<
  Parameters extends Record<string, unknown> = Record<string, unknown>,
  Results = unknown,
  Metadata extends Record<string, unknown> = Record<string, unknown>
> {
  /** Artifact schema identifier. */
  schemaVersion: typeof BENCHMARK_ARTIFACT_SCHEMA_VERSION

  /** Stable benchmark suite identifier. */
  suite: string

  /** ISO-8601 artifact creation time. */
  generatedAt: string

  /** Host, runtime, CPU, and memory environment snapshot. */
  environment: EnvironmentSnapshot

  /** Effective benchmark parameters. */
  parameters: Parameters

  /** Suite-specific benchmark results. */
  results: Results

  /** Optional suite-specific metadata. */
  metadata?: Metadata
}

/** Inputs used to create a versioned benchmark artifact. */
export interface CreateBenchmarkArtifactOptions<
  Parameters extends Record<string, unknown>,
  Results,
  Metadata extends Record<string, unknown>
> {
  /** Stable non-empty benchmark suite identifier. */
  suite: string

  /** Effective benchmark parameters. */
  parameters: Parameters

  /** Suite-specific benchmark results. */
  results: Results

  /** Optional suite-specific metadata. */
  metadata?: Metadata

  /**
   * ISO-8601 artifact creation time.
   * @default The current time.
   */
  generatedAt?: string

  /**
   * Host and runtime environment.
   * @default A fresh `snapshotEnvironment()` result.
   */
  environment?: EnvironmentSnapshot
}

/**
 * Constructs a validated, versioned benchmark artifact value.
 * @param options Suite identity, parameters, results, metadata, and provenance.
 * @param options.suite Stable benchmark suite identifier.
 * @param options.parameters Effective benchmark parameters.
 * @param options.results Suite-specific result value.
 * @param options.metadata Optional suite-specific metadata.
 * @param options.generatedAt ISO-8601 artifact creation time.
 * @param options.environment Host and runtime environment snapshot.
 * @returns A JSON-serializable artifact using the current schema version.
 * @throws {TypeError} If identifiers, records, or the generated timestamp are invalid.
 */
export function createBenchmarkArtifact<
  Parameters extends Record<string, unknown>,
  Results,
  Metadata extends Record<string, unknown> = Record<string, unknown>
>({
  suite,
  parameters,
  results,
  metadata,
  generatedAt = new Date().toISOString(),
  environment = snapshotEnvironment()
}: CreateBenchmarkArtifactOptions<Parameters, Results, Metadata>): BenchmarkArtifact<Parameters, Results, Metadata> {
  requireNonEmptyString(suite, 'benchmark artifact suite')

  if (!isRecord(parameters)) {
    throw new TypeError('benchmark artifact parameters must be an object')
  }

  if (metadata !== undefined && !isRecord(metadata)) {
    throw new TypeError('benchmark artifact metadata must be an object')
  }

  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
    throw new TypeError('benchmark artifact generatedAt must be an ISO date string')
  }

  return {
    schemaVersion: BENCHMARK_ARTIFACT_SCHEMA_VERSION,
    suite,
    generatedAt,
    environment,
    parameters,
    results,
    ...(metadata === undefined ? {} : { metadata })
  }
}

/**
 * Atomically writes a benchmark artifact as indented JSON with a trailing newline.
 *
 * A uniquely named sibling file is renamed into place and removed on failure.
 * @param filePath Destination path.
 * @param artifact Artifact to serialize.
 * @returns A Promise that resolves after the atomic rename completes.
 * @throws {TypeError} If `filePath` is empty or contains a null byte.
 */
export async function writeBenchmarkArtifact(filePath: string, artifact: BenchmarkArtifact): Promise<void> {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0')) {
    throw new TypeError('benchmark artifact path must be a non-empty path')
  }

  const resolved = path.resolve(filePath)
  const directory = path.dirname(resolved)
  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`)

  await fs.mkdir(directory, { recursive: true })

  try {
    await fs.writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, resolved)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

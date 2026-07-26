import { requireNonEmptyString, requirePositiveInteger } from '../validation/value-parsers.js'
import measureBatch, { type BatchMeasurement, type MeasureBatchOptions } from './measure-batch.js'

/** Batch measurement options with stable benchmark scenario dimensions. */
export interface MeasureScenarioOptions extends MeasureBatchOptions {
  /** Non-empty scenario identifier used in reports and artifacts. */
  name: string

  /**
   * Logical connection count associated with the scenario.
   * @default `1`
   */
  connections?: number

  /**
   * Logical pipelining depth associated with the scenario.
   * @default `1`
   */
  pipelining?: number
}

/** Batch measurement annotated with stable scenario dimensions. */
export interface ScenarioMeasurement extends BatchMeasurement {
  /** Scenario identifier. */
  name: string

  /** Effective logical connection count. */
  connections: number

  /** Effective logical pipelining depth. */
  pipelining: number
}

export default async function measureScenario({
  name,
  connections = 1,
  pipelining = 1,
  ...batch
}: MeasureScenarioOptions): Promise<ScenarioMeasurement> {
  requireNonEmptyString(name, 'scenario name')
  requirePositiveInteger(connections, 'connections')
  requirePositiveInteger(pipelining, 'pipelining')

  return {
    name,
    connections,
    pipelining,
    ...(await measureBatch(batch))
  }
}

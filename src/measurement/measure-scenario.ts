import measureBatch, { type BatchMeasurement, type MeasureBatchOptions } from './measure-batch.js'

export interface MeasureScenarioOptions extends MeasureBatchOptions {
  name: string
  connections?: number
  pipelining?: number
}

export interface ScenarioMeasurement extends BatchMeasurement {
  name: string
  connections: number
  pipelining: number
}

export default async function measureScenario({
  name,
  connections = 1,
  pipelining = 1,
  ...batch
}: MeasureScenarioOptions): Promise<ScenarioMeasurement> {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('scenario name must be a non-empty string')
  }

  validatePositiveInteger(connections, 'connections')
  validatePositiveInteger(pipelining, 'pipelining')

  return {
    name,
    connections,
    pipelining,
    ...(await measureBatch(batch))
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
}

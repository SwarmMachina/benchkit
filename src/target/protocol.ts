import type { SerializedError } from '../control/errors.js'
import { isRecord } from '../control/value-guards.js'

export const RUNTIME_COMMAND_TYPES = ['benchkit:metrics:start', 'benchkit:metrics:stop', 'benchkit:shutdown'] as const

export type RuntimeCommandType = (typeof RUNTIME_COMMAND_TYPES)[number]

export interface RuntimeCommand {
  type: RuntimeCommandType
  id: string
  payload?: unknown
}

export interface RuntimeResponse {
  type: 'benchkit:response'
  id: string
  status: 'ok' | 'error'
  payload?: unknown
  error?: SerializedError
}

export interface RuntimeReady {
  type: 'benchkit:ready'
  payload: {
    port: number
    [key: string]: unknown
  }
}

export function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  return (
    isRecord(value) && typeof value.id === 'string' && RUNTIME_COMMAND_TYPES.includes(value.type as RuntimeCommandType)
  )
}

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  return isRecord(value) && value.type === 'benchkit:response' && typeof value.id === 'string'
}

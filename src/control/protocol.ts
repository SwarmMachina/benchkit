import { ProtocolError, VersionMismatchError, type SerializedError } from './errors.js'
import type { TargetState } from './state-machine.js'
import { isRecord } from './value-guards.js'
import { PROTOCOL_VERSION } from './version.js'

export type RequestType = 'target:start' | 'metrics:start' | 'metrics:stop' | 'target:stop'
export type EventType = 'agent:ready' | 'agent:error' | 'target:exit'

export interface ControlRequest {
  version: typeof PROTOCOL_VERSION
  id: string
  type: RequestType
  payload: unknown
}

export interface ControlResponse {
  version: typeof PROTOCOL_VERSION
  id: string
  type: RequestType
  status: 'ok' | 'error'
  state?: TargetState
  payload?: unknown
  error?: SerializedError
}

export interface ControlEvent {
  version: typeof PROTOCOL_VERSION
  id: null
  type: EventType
  status: 'ok' | 'error'
  state?: TargetState
  payload?: unknown
  error?: SerializedError
}

export function parseRequest(value: unknown): ControlRequest {
  if (!isRecord(value)) {
    throw new ProtocolError('Control request must be an object')
  }

  if (value.version !== PROTOCOL_VERSION) {
    throw new VersionMismatchError('protocol', PROTOCOL_VERSION, String(value.version))
  }

  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) {
    throw new ProtocolError('Control request id must be a non-empty string of at most 128 characters')
  }

  if (!['target:start', 'metrics:start', 'metrics:stop', 'target:stop'].includes(String(value.type))) {
    throw new ProtocolError(`Unknown control request type: ${String(value.type)}`)
  }

  return {
    version: PROTOCOL_VERSION,
    id: value.id,
    type: value.type as RequestType,
    payload: value.payload
  }
}

export function parseResponse(value: unknown): ControlResponse | ControlEvent {
  if (!isRecord(value)) {
    throw new ProtocolError('Control response must be an object')
  }

  if (value.version !== PROTOCOL_VERSION) {
    throw new VersionMismatchError('protocol', PROTOCOL_VERSION, String(value.version))
  }

  if (value.id !== null && typeof value.id !== 'string') {
    throw new ProtocolError('Control response id must be a string or null')
  }

  if (value.status !== 'ok' && value.status !== 'error') {
    throw new ProtocolError('Control response status must be "ok" or "error"')
  }

  if (typeof value.type !== 'string') {
    throw new ProtocolError('Control response type must be a string')
  }

  if (value.status === 'error' && !isRecord(value.error)) {
    throw new ProtocolError('Error response must include a serializable error')
  }

  return value as unknown as ControlResponse | ControlEvent
}

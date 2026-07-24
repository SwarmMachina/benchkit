import { ProtocolError, VersionMismatchError, type SerializedError } from './errors.js'
import type { TargetState } from './state-machine.js'
import { isRecord } from './value-guards.js'
import { PROTOCOL_VERSION } from './version.js'

/** Correlated runner-to-agent control request names. */
export type RequestType = 'target:start' | 'metrics:start' | 'metrics:stop' | 'target:stop'

/** Unsolicited agent-to-runner control event names. */
export type EventType = 'agent:ready' | 'agent:error' | 'target:exit'

/** Versioned request sent from a benchmark runner to the target agent. */
export interface ControlRequest {
  /** Control protocol version. */
  version: typeof PROTOCOL_VERSION

  /** Non-empty correlation identifier, limited to 128 characters. */
  id: string

  /** Requested target lifecycle operation. */
  type: RequestType

  /** Operation-specific request data. */
  payload: unknown
}

/** Correlated response sent by the target agent. */
export interface ControlResponse {
  /** Control protocol version. */
  version: typeof PROTOCOL_VERSION

  /** Correlation identifier copied from the request. */
  id: string

  /** Request type being answered. */
  type: RequestType

  /** Whether the operation succeeded. */
  status: 'ok' | 'error'

  /** Target lifecycle state after handling the request. */
  state?: TargetState

  /** Operation-specific success data. */
  payload?: unknown

  /** Serialized failure data when `status` is `'error'`. */
  error?: SerializedError
}

/** Unsolicited lifecycle event emitted by the target agent. */
export interface ControlEvent {
  /** Control protocol version. */
  version: typeof PROTOCOL_VERSION

  /** Always `null` because events do not correlate to requests. */
  id: null

  /** Event name. */
  type: EventType

  /** Whether the event reports normal state or failure. */
  status: 'ok' | 'error'

  /** Target lifecycle state associated with the event. */
  state?: TargetState

  /** Event-specific data. */
  payload?: unknown

  /** Serialized failure data when `status` is `'error'`. */
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

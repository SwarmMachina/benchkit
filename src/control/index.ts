export {
  BenchkitError,
  ConfigurationError,
  InvalidStateError,
  ProtocolError,
  TargetUnreachableError,
  TimeoutError,
  TransportError,
  UnsupportedFeatureError,
  VersionMismatchError,
  errorFromSerialized,
  serializeError
} from './errors.js'
export type { SerializedError } from './errors.js'
export { snapshotEnvironment } from './environment.js'
export type { EnvironmentSnapshot } from './environment.js'
export { NdjsonDecoder, encodeNdjson } from './ndjson.js'
export type { NdjsonDecoderOptions } from './ndjson.js'
export { parseRequest, parseResponse } from './protocol.js'
export type { ControlEvent, ControlRequest, ControlResponse, EventType, RequestType } from './protocol.js'
export { TargetStateMachine } from './state-machine.js'
export type { TargetState } from './state-machine.js'
export { BENCHKIT_VERSION, PROTOCOL_VERSION } from './version.js'

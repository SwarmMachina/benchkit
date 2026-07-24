import { BenchkitError } from './benchkit-error.js'

/** Indicates a target reported ready but could not be reached over TCP. */
export class TargetUnreachableError extends BenchkitError {
  constructor(details: { bindHost: string; connectHost: string; port: number; lastNetworkError: string }) {
    super(
      `Target reported ready but ${details.connectHost}:${details.port} is unreachable; ` +
        'check the target listen address and firewall rules',
      'TARGET_UNREACHABLE',
      details
    )
  }
}

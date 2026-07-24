import { BenchkitError } from './benchkit-error.js'

/** Indicates a requested capability is unavailable for the selected mode. */
export class UnsupportedFeatureError extends BenchkitError {
  constructor(feature: string, mode: string) {
    super(`${feature} is not supported for target mode "${mode}"`, 'UNSUPPORTED_FEATURE', { feature, mode })
  }
}

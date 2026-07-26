/**
 * Computes signed candidate-versus-reference percentage change.
 * @param candidate Candidate measurement.
 * @param reference Reference measurement used as the denominator.
 * @returns `(candidate - reference) / reference * 100`, or `null` for invalid input or zero reference.
 */
export function percentDelta(candidate: number, reference: number): number | null {
  return Number.isFinite(candidate) && Number.isFinite(reference) && reference !== 0
    ? ((candidate - reference) / reference) * 100
    : null
}

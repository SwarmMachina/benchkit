export function percentDelta(candidate: number, reference: number): number | null {
  return Number.isFinite(candidate) && Number.isFinite(reference) && reference !== 0
    ? ((candidate - reference) / reference) * 100
    : null
}

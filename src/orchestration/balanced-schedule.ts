/** Options for deterministic alternating candidate/reference run order. */
export interface BalancedScheduleOptions<Candidate extends string = string, Reference extends string = string> {
  /** Number of rounds to generate. */
  runs: number

  /**
   * Candidate label.
   * @default `'candidate'`
   */
  candidate?: Candidate

  /**
   * Reference label.
   * @default `'reference'`
   */
  reference?: Reference

  /**
   * Requires an even round count for exact AB/BA balance.
   * @default `true`
   */
  strictBalance?: boolean
}

/** One round in a deterministic paired benchmark schedule. */
export interface BalancedScheduleEntry<Label extends string = string> {
  /** One-based round number. */
  round: number

  /** Candidate/reference execution order for this round. */
  order: readonly [Label, Label]
}

export function balancedSchedule<Candidate extends string = 'candidate', Reference extends string = 'reference'>({
  runs,
  candidate = 'candidate' as Candidate,
  reference = 'reference' as Reference,
  strictBalance = true
}: BalancedScheduleOptions<Candidate, Reference>): BalancedScheduleEntry<Candidate | Reference>[] {
  if (!Number.isSafeInteger(runs) || runs <= 0) {
    throw new RangeError('runs must be a positive safe integer')
  }

  if (strictBalance && runs % 2 !== 0) {
    throw new RangeError('runs must be even when strictBalance is enabled')
  }

  if (!candidate || !reference) {
    throw new TypeError('candidate and reference labels must be non-empty')
  }

  if (candidate === (reference as string)) {
    throw new RangeError('candidate and reference labels must differ')
  }

  return Array.from({ length: runs }, (_, index) => ({
    round: index + 1,
    order:
      index % 2 === 0
        ? ([candidate, reference] as const)
        : ([reference, candidate] as readonly [Candidate | Reference, Candidate | Reference])
  }))
}

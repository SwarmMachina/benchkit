export interface BalancedScheduleOptions<Candidate extends string = string, Reference extends string = string> {
  runs: number
  candidate?: Candidate
  reference?: Reference
  strictBalance?: boolean
}

export interface BalancedScheduleEntry<Label extends string = string> {
  round: number
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

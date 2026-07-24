import { InvalidStateError } from './errors.js'

/**
 * Observable lifecycle state of a managed target.
 *
 * Terminal states are `stopped` and `failed`.
 */
export type TargetState = 'starting' | 'ready' | 'measuring' | 'stopping' | 'stopped' | 'failed'

const TRANSITIONS: Readonly<Record<TargetState, readonly TargetState[]>> = {
  starting: ['ready', 'failed'],
  ready: ['measuring', 'stopping', 'failed'],
  measuring: ['ready', 'stopping', 'failed'],
  stopping: ['stopped', 'failed'],
  stopped: [],
  failed: []
}

/** Validates and applies explicit managed-target lifecycle transitions. */
export class TargetStateMachine {
  #state: TargetState

  constructor(initial: TargetState = 'starting') {
    this.#state = initial
  }

  /** Current target lifecycle state. */
  get state(): TargetState {
    return this.#state
  }

  /** Returns whether a transition from the current state is allowed. */
  canTransition(to: TargetState): boolean {
    return TRANSITIONS[this.#state].includes(to)
  }

  /** Throws `InvalidStateError` unless the requested transition is allowed. */
  assertCanTransition(to: TargetState): void {
    if (!this.canTransition(to)) {
      throw new InvalidStateError(this.#state, to, TRANSITIONS[this.#state])
    }
  }

  /** Applies an allowed transition and returns the new state. */
  transition(to: TargetState): TargetState {
    this.assertCanTransition(to)

    this.#state = to

    return this.#state
  }
}

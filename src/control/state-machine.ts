import { InvalidStateError } from './errors.js'

export type TargetState = 'starting' | 'ready' | 'measuring' | 'stopping' | 'stopped' | 'failed'

const TRANSITIONS: Readonly<Record<TargetState, readonly TargetState[]>> = {
  starting: ['ready', 'failed'],
  ready: ['measuring', 'stopping', 'failed'],
  measuring: ['ready', 'stopping', 'failed'],
  stopping: ['stopped', 'failed'],
  stopped: [],
  failed: []
}

export class TargetStateMachine {
  #state: TargetState

  constructor(initial: TargetState = 'starting') {
    this.#state = initial
  }

  get state(): TargetState {
    return this.#state
  }

  canTransition(to: TargetState): boolean {
    return TRANSITIONS[this.#state].includes(to)
  }

  assertCanTransition(to: TargetState): void {
    if (!this.canTransition(to)) {
      throw new InvalidStateError(this.#state, to, TRANSITIONS[this.#state])
    }
  }

  transition(to: TargetState): TargetState {
    this.assertCanTransition(to)

    this.#state = to

    return this.#state
  }
}

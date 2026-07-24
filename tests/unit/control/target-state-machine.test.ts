import assert from 'node:assert/strict'
import test from 'node:test'
import { InvalidStateError, TargetStateMachine } from '@swarmmachina/benchkit/control'

test('target state machine follows the explicit measurement lifecycle', () => {
  const machine = new TargetStateMachine()

  assert.equal(machine.transition('ready'), 'ready')
  assert.equal(machine.transition('measuring'), 'measuring')
  assert.equal(machine.transition('ready'), 'ready')
  assert.equal(machine.transition('stopping'), 'stopping')
  assert.equal(machine.transition('stopped'), 'stopped')
})

test('target state machine rejects invalid and hidden transitions', () => {
  const machine = new TargetStateMachine()

  assert.throws(() => machine.transition('measuring'), InvalidStateError)
  assert.equal(machine.state, 'starting')
  machine.transition('failed')
  assert.throws(() => machine.transition('stopped'), InvalidStateError)
})

test('explicit stop is allowed while measuring for load failure cleanup', () => {
  const machine = new TargetStateMachine('ready')

  machine.transition('measuring')
  assert.equal(machine.transition('stopping'), 'stopping')
})

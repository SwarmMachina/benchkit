import {
  isNonBlankString,
  isNonNegativeFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveFiniteNumber,
  isPositiveSafeInteger,
  isRecord
} from './predicates.js'

export function requireObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object`)
  }
}

export function requirePositiveInteger(value: number, name: string): number {
  if (!isPositiveSafeInteger(value)) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }

  return value
}

export function requireNonNegativeInteger(value: number, name: string): number {
  if (!isNonNegativeSafeInteger(value)) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }

  return value
}

export function requirePositiveNumber(value: number, name: string): number {
  if (!isPositiveFiniteNumber(value)) {
    throw new TypeError(`${name} must be a positive finite number`)
  }

  return value
}

export function requireNonNegativeNumber(value: number, name: string): number {
  if (!isNonNegativeFiniteNumber(value)) {
    throw new TypeError(`${name} must be a non-negative finite number`)
  }

  return value
}

export function requireNonEmptyString(value: unknown, name: string): string {
  if (!isNonBlankString(value)) {
    throw new TypeError(`${name} must be a non-empty string`)
  }

  return value
}

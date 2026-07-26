import { isRecord } from '../validation/predicates.js'
import { ConfigurationError } from './errors.js'

export function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65_535
}

export function requireNulFreeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.includes('\0'))) {
    throw new ConfigurationError(`${field} must be an array of strings without NUL bytes`)
  }

  return [...value]
}

export function requireStringRecord(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== 'string')) {
    throw new ConfigurationError(`${field} must be a record of strings`)
  }

  return { ...value } as Record<string, string>
}

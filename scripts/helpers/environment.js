/**
 * Reads a positive number from an environment variable.
 * @param {string} name
 * @param {number} [fallback]
 * @returns {number | undefined}
 */
export function numberEnvironment(name, fallback) {
  const raw = process.env[name]

  if (raw === undefined) {
    return fallback
  }

  const value = Number(raw)

  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number`)
  }

  return value
}

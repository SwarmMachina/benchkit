export interface LoadUrlPolicy {
  operation: string
  protocols: readonly string[]
  absoluteKind: string
  credentialsError: string
}

export function normalizeLoadUrl(value: string | URL, policy: LoadUrlPolicy): URL {
  const url = toUrl(value, policy.absoluteKind)

  if (!policy.protocols.includes(url.protocol)) {
    throw new TypeError(`${policy.operation} URL must use ${policy.protocols.join(' or ')}`)
  }

  if (url.username || url.password) {
    throw new TypeError(policy.credentialsError)
  }

  if (url.hash) {
    throw new TypeError(`${policy.operation} URL must not contain a fragment`)
  }

  return url
}

function toUrl(value: string | URL, absoluteKind: string): URL {
  if (value instanceof URL) {
    return new URL(value)
  }

  if (typeof value !== 'string' || value === '') {
    throw new TypeError('url must be a non-empty string or URL')
  }

  try {
    return new URL(value)
  } catch {
    throw new TypeError(`url must be an absolute ${absoluteKind} URL`)
  }
}

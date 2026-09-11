const REDACTED = '[redacted]'

// Anything under a key like this is dropped whole rather than masked.
const SENSITIVE_KEY = /token|secret|key|authorization|cookie|password/i

// Sentry token formats, so a leaked value is caught even if it never passed through the env.
const TOKEN_SHAPES = [
  /sntry[a-z]_[A-Za-z0-9._-]+/g,
  /\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
]

function configuredSecrets(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => SENSITIVE_KEY.test(name) && typeof value === 'string')
    .map(([, value]) => value as string)
    // A short value would match far too much text; those are not credentials worth guarding.
    .filter((value) => value.length >= 8)
}

function redactString(value: string): string {
  let output = value
  // Whole-value replacement only. Partial masking of a short-lived token is still disclosure.
  for (const secret of configuredSecrets()) output = output.split(secret).join(REDACTED)
  for (const shape of TOKEN_SHAPES) output = output.replace(shape, REDACTED)
  return output
}

/**
 * The single scrubbing point. Everything logged or serialised passes through here, so there is
 * no second path where a credential could survive.
 */
export function redact<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as T
  if (Array.isArray(value)) return value.map((entry) => redact(entry)) as T

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry)
    }
    return output as T
  }

  return value
}

import { ConfigError } from '@/lib/sentry/errors'

const SENSITIVE_NAME = /TOKEN|SECRET|KEY/i

export function unauthenticatedProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    !process.env.DASHBOARD_ACCESS_SECRET &&
    process.env.ALLOW_UNAUTHENTICATED === 'true'
  )
}

/**
 * Fails closed at startup rather than documenting a hazard and hoping. This app holds a token
 * with read access to the whole organization's error data and has no user system by design.
 */
export function assertServerSafety(): void {
  const exposed = Object.keys(process.env).filter(
    (name) => name.startsWith('NEXT_PUBLIC_') && SENSITIVE_NAME.test(name),
  )
  if (exposed.length > 0) {
    throw new ConfigError(
      'A credential is exposed to the browser bundle.',
      `These NEXT_PUBLIC_ variables look like credentials and are inlined into client JavaScript: ${exposed.join(', ')}. Rename them without the NEXT_PUBLIC_ prefix.`,
    )
  }

  if (process.env.NODE_ENV !== 'production') return

  if (!process.env.DASHBOARD_ACCESS_SECRET && process.env.ALLOW_UNAUTHENTICATED !== 'true') {
    throw new ConfigError(
      'Refusing to start: this build is unauthenticated and holds a Sentry token.',
      'Set DASHBOARD_ACCESS_SECRET to a shared secret of at least 16 characters, or set ALLOW_UNAUTHENTICATED=true to acknowledge running without a gate (only safe when bound to localhost behind a tunnel).',
    )
  }
}

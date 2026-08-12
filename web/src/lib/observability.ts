/**
 * Browser error capture via the Sentry SDK → self-hosted GlitchTip.
 *
 * GlitchTip is Sentry-DSN compatible, so @sentry/react points straight at it.
 * Config is baked in at BUILD time (Vite inlines VITE_*), passed as docker
 * build args from docker-compose:
 *
 *   VITE_SENTRY_DSN          project DSN. BLANK = disabled (init no-ops).
 *   VITE_SENTRY_ENVIRONMENT  environment tag (production/staging/dev).
 *
 * Changing the DSN requires rebuilding the `web` image (start.sh does this).
 */
import * as Sentry from '@sentry/react'

const DSN = (import.meta.env.VITE_SENTRY_DSN ?? '').trim()
const ENVIRONMENT = (import.meta.env.VITE_SENTRY_ENVIRONMENT ?? 'production').trim() || 'production'

/** True when a DSN is configured, i.e. the browser will send events. */
export function isObservabilityConfigured(): boolean {
  return Boolean(DSN)
}

/** Initialize Sentry once at app boot. No-op when VITE_SENTRY_DSN is blank, so
 *  the app behaves identically with error capture off. Never throws. */
export function initObservability(): void {
  if (!DSN) return
  try {
    Sentry.init({
      dsn: DSN,
      environment: ENVIRONMENT,
      // Errors only by default — no performance/replay sampling, to keep the
      // payload to a small self-hosted instance light. Turn these up as needed.
      tracesSampleRate: 0,
    })
  } catch {
    // Monitoring must never break the app shell.
  }
}

/** Sentry's error boundary — wraps the app so render errors are captured and a
 *  fallback is shown. When DSN is blank it still renders children + fallback,
 *  just without reporting. */
export const ErrorBoundary = Sentry.ErrorBoundary

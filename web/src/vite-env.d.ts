/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only: backend target the Vite proxy forwards /api to. */
  readonly VITE_API_PROXY_TARGET?: string
  /** File storage backend label shown in the UI ('backblaze' | 'local'). */
  readonly VITE_STORAGE_TYPE?: string
  /** n8n webhook configuration (see lib/n8n.ts). */
  readonly VITE_N8N_BASE_URL?: string
  readonly VITE_N8N_WEBHOOK_URL?: string
  /** Sentry/GlitchTip DSN for browser error capture (see lib/observability.ts).
   *  Blank = disabled. Baked in at build time via docker-compose build args. */
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

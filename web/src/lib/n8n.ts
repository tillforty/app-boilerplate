/**
 * n8n integration: build webhook URLs from env, never hardcode them.
 *
 * Configure via Vite env (leave unset to disable n8n calls entirely):
 *   VITE_N8N_BASE_URL     root of the n8n instance, e.g. https://n8n.example.com
 *   VITE_N8N_WEBHOOK_URL  base for webhooks; defaults to {VITE_N8N_BASE_URL}/webhook
 *
 * A webhook's full URL is {webhook base}/{path}, where `path` is the path
 * configured on the n8n Webhook trigger node.
 */
const BASE_URL = (import.meta.env.VITE_N8N_BASE_URL ?? '').replace(/\/+$/, '')
const WEBHOOK_URL = (
  import.meta.env.VITE_N8N_WEBHOOK_URL ?? (BASE_URL ? `${BASE_URL}/webhook` : '')
).replace(/\/+$/, '')

/** True when an n8n webhook base URL is available from the environment. */
export function isN8nConfigured(): boolean {
  return Boolean(WEBHOOK_URL)
}

/** Absolute URL for the n8n webhook at `path` (the trigger node's path). */
export function n8nWebhookUrl(path: string): string {
  if (!WEBHOOK_URL) {
    throw new Error('VITE_N8N_WEBHOOK_URL (or VITE_N8N_BASE_URL) is not configured')
  }
  return `${WEBHOOK_URL}/${path.replace(/^\/+/, '')}`
}

/** POST `payload` as JSON to an n8n webhook. No-ops when n8n is unconfigured. */
export async function fireN8nWebhook(path: string, payload: unknown): Promise<void> {
  if (!WEBHOOK_URL) return
  await fetch(n8nWebhookUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

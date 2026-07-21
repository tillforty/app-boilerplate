import { ApiError } from '@/lib/api'
import { useDemo } from '@/context/DemoContext'
import { useTranslation } from '@/i18n'

/**
 * Renders a page-level load error. When the app is in demo mode and the failure
 * is a permission denial (403 — the demo account lacks a role permission), it
 * shows a friendly "read-only demo" notice instead of the raw
 * "Missing permission: …" backend message. Any other error renders as usual.
 */
export function DataLoadError({ error }: { error: unknown }) {
  const { enabled } = useDemo()
  const { t } = useTranslation()
  if (!error) return null

  const isPermissionDenied = error instanceof ApiError && error.status === 403
  if (enabled && isPermissionDenied) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        {t('demo.readOnly')}
      </div>
    )
  }

  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  )
}

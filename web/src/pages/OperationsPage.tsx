import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Circle, ExternalLink, RefreshCw, Workflow as WorkflowIcon } from 'lucide-react'
import { usePermissions } from '@/context/PermissionsContext'
import { useTranslation } from '@/i18n'
import {
  EXECUTION_STATUSES,
  getOpsSetup,
  listExecutions,
  listWorkflows,
  type Execution,
  type ExecutionStatus,
  type OpsSetupStatus,
  type Workflow,
} from '@/lib/operations'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableEmptyState } from '@/components/ui/table-empty-state'

/** Sentinel for the "any status / any workflow" option — Radix Select can't
 *  carry an empty string as a value. */
const ANY = '__any__'

/** States where the run is still moving, so the pill spins. */
const IN_PROGRESS = ['running', 'waiting', 'new']

/** Statuses we have a translation for. `crashed` never comes back from the
 *  status filter but does appear on rows, so it is display-only. */
const TRANSLATED_STATUSES = new Set<string>([...EXECUTION_STATUSES, 'crashed'])

function fmt(dt: string | null): string {
  if (!dt) return '—'
  const d = new Date(dt)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** Compact run time: 940ms · 12.4s · 3m 07s. */
function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function statusClass(status: string | null): string {
  switch (status) {
    case 'success':
      return 'text-green-600 dark:text-green-500'
    case 'error':
    case 'crashed':
      return 'text-destructive'
    case 'waiting':
    case 'running':
    case 'new':
      return 'text-amber-600 dark:text-amber-500'
    default:
      return 'text-muted-foreground'
  }
}

/** Shown until n8n is reachable with an API key. On a stock deploy start.sh
 *  provisions both, so this is the "you turned n8n off" / "self-hosted
 *  elsewhere" path rather than the normal first run. */
function SetupChecklist({ setup }: { setup: OpsSetupStatus }) {
  const { t } = useTranslation()
  const steps = [
    { done: setup.base_url_configured, title: t('operations.step1Title'), desc: t('operations.step1Desc') },
    { done: setup.api_key_configured, title: t('operations.step2Title'), desc: t('operations.step2Desc') },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('operations.setupTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('operations.setupIntro')}</p>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              {s.done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/50" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {setup.ui_url && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open(setup.ui_url!, '_blank', 'noopener,noreferrer')}
            >
              {t('operations.openN8n')}
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t('operations.redeployNote')}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function OperationsPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canView = can('roles:manage')

  const [setup, setSetup] = useState<OpsSetupStatus | null>(null)
  const [executions, setExecutions] = useState<Execution[] | null>(null)
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<ExecutionStatus | null>(null)
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!canView) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    getOpsSetup()
      .then(async (s) => {
        if (!active) return
        setSetup(s)
        if (!s.api_configured) {
          setExecutions(null)
          return
        }
        const [page, wfs] = await Promise.all([
          listExecutions({ status, workflowId }),
          // The workflow filter is a convenience — an instance with none yet
          // shouldn't blank out the page, so its failure isn't fatal.
          listWorkflows().catch(() => [] as Workflow[]),
        ])
        if (!active) return
        setExecutions(page.executions)
        setNextCursor(page.next_cursor)
        setWorkflows(wfs)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : t('operations.loadFailed'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [canView, reloadKey, status, workflowId, t])

  const loadMore = useCallback(async () => {
    if (!nextCursor) return
    try {
      setLoadingMore(true)
      const page = await listExecutions({ status, workflowId, cursor: nextCursor })
      setExecutions((prev) => [...(prev ?? []), ...page.executions])
      setNextCursor(page.next_cursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('operations.loadFailed'))
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, status, workflowId, t])

  const rows = executions ?? []

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('operations.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('operations.subtitle')}</p>
      </div>

      {!canView ? (
        <p className="text-sm text-muted-foreground">{t('operations.noPermission')}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : setup && !setup.api_configured ? (
        <SetupChecklist setup={setup} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status ?? ANY}
              onValueChange={(v) => setStatus(v === ANY ? null : (v as ExecutionStatus))}
            >
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('operations.anyStatus')}</SelectItem>
                {EXECUTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`operations.status_${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {workflows.length > 0 && (
              <Select
                value={workflowId ?? ANY}
                onValueChange={(v) => setWorkflowId(v === ANY ? null : v)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('operations.anyWorkflow')}</SelectItem>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name || w.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="ml-auto flex items-center gap-2">
              {setup?.ui_url && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(setup.ui_url!, '_blank', 'noopener,noreferrer')}
                >
                  {t('operations.openN8n')}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('operations.refresh')}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('operations.colWorkflow')}</TableHead>
                  <TableHead>{t('operations.colStatus')}</TableHead>
                  <TableHead>{t('operations.colMode')}</TableHead>
                  <TableHead>{t('operations.colStarted')}</TableHead>
                  <TableHead className="text-right">{t('operations.colDuration')}</TableHead>
                  <TableHead className="text-right">{t('operations.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableEmptyState
                    colSpan={6}
                    icon={WorkflowIcon}
                    title={t('operations.emptyTitle')}
                    description={t('operations.empty')}
                  />
                ) : (
                  rows.map((ex) => (
                    <TableRow key={ex.id}>
                      <TableCell className="max-w-md">
                        <div className="truncate font-medium">
                          {ex.workflow_name || t('operations.unknownWorkflow')}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          #{ex.id}
                          {ex.retry_of && ` · ${t('operations.retryOf', { id: ex.retry_of })}`}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          label={
                            ex.status
                              ? TRANSLATED_STATUSES.has(ex.status)
                                ? t(`operations.status_${ex.status}`)
                                : ex.status
                              : '—'
                          }
                          active={IN_PROGRESS.includes(ex.status ?? '')}
                          className={statusClass(ex.status)}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ex.mode ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmt(ex.started_at)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtDuration(ex.duration_ms)}
                      </TableCell>
                      <TableCell className="text-right">
                        {ex.web_url && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              window.open(ex.web_url!, '_blank', 'noopener,noreferrer')
                            }
                          >
                            {t('operations.open')}
                            <ExternalLink className="ml-2 h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {nextCursor && (
            <div className="flex justify-center">
              <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? t('common.loading') : t('operations.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

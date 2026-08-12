import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  GitPullRequest,
  MessageCircleQuestion,
  Plus,
  RefreshCw,
  Rocket,
  Ban,
  RotateCcw,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from '@/i18n'
import { usePermissions } from '@/context/PermissionsContext'
import {
  DEPLOYMENT_IN_PROGRESS,
  JOB_IN_PROGRESS,
  answerJob,
  cancelJob,
  createJob,
  deployJob,
  getDevConfig,
  getJob,
  listDeployments,
  listJobs,
  retryJob,
  type Deployment,
  type DevConfig,
  type Job,
  type JobDetail,
  type JobStatus,
} from '@/lib/development'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableEmptyState } from '@/components/ui/table-empty-state'

const POLL_MS = 5000

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

const STATUS_VARIANT: Record<JobStatus, BadgeVariant> = {
  pending: 'secondary',
  running: 'secondary',
  answer_pending: 'outline',
  deployment_ready: 'default',
  deploying: 'secondary',
  deployed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
}

/** Extra colour for the two states that need the operator's attention. */
const STATUS_CLASS: Partial<Record<JobStatus, string>> = {
  answer_pending: 'border-amber-500 text-amber-600 dark:text-amber-500',
  deployment_ready: 'bg-green-600 hover:bg-green-600',
  deployed: 'bg-green-600 hover:bg-green-600',
}

function fmt(dt: string | null): string {
  if (!dt) return '—'
  const d = new Date(dt)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function StatusBadge({ status }: { status: JobStatus }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      className={STATUS_CLASS[status]}
      loading={JOB_IN_PROGRESS.includes(status)}
    >
      {t(`agent.status_${status}`)}
    </Badge>
  )
}

/** PR number as a label that links straight to GitHub. */
function PrLink({ number, url }: { number: number | null; url: string | null }) {
  if (number === null) return <span className="text-muted-foreground">—</span>
  const label = `#${number}`
  if (!url) return <span className="tabular-nums">{label}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      <GitPullRequest className="h-3.5 w-3.5" />
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

/** The shipped version of a job: merged commit, who deployed it and when.
 *  Empty for jobs that were never deployed. */
function DeployedCell({ dep }: { dep: Deployment | undefined }) {
  if (!dep) return <span className="text-muted-foreground">—</span>
  return (
    <div className="whitespace-nowrap">
      <div className="font-mono text-xs">
        {dep.merge_sha ? dep.merge_sha.slice(0, 8) : (dep.version_label ?? '—')}
      </div>
      <div className="text-xs text-muted-foreground">
        {[dep.deployed_by_name, fmt(dep.finished_at ?? dep.created_at)]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </div>
  )
}

/** Banner shown when the pipeline can't run yet, with a link to the fix. */
function SetupNotice({ config }: { config: DevConfig }) {
  const { t } = useTranslation()
  const problems: string[] = []
  if (!config.repo_full_name || !config.has_token) problems.push(t('agent.setupNoRepo'))
  if (!config.agent.configured) {
    problems.push(
      config.agent.reason === 'no_key' ? t('agent.setupNoKey') : t('agent.setupNoAgent'),
    )
  }
  if (!config.runner_online) problems.push(t('agent.setupNoRunner'))
  if (problems.length === 0) return null
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <ul className="list-inside list-disc space-y-0.5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link to="/settings/app?tab=development">{t('agent.setupLink')}</Link>
      </Button>
    </div>
  )
}

/** `onCount` feeds the tab-strip badge on DevelopmentPage, which owns no data. */
export default function AgentTab({ onCount }: { onCount?: (n: number) => void }) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canRun = can('development:run')
  const canDeploy = can('development:deploy')

  const [config, setConfig] = useState<DevConfig | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newOpen, setNewOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [answerFor, setAnswerFor] = useState<Job | null>(null)
  const [answer, setAnswer] = useState('')
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  // Guards against a slow in-flight refresh overwriting fresher state.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [c, j, d] = await Promise.all([getDevConfig(), listJobs(), listDeployments()])
      if (!mounted.current) return
      setConfig(c)
      setJobs(j)
      setDeployments(d)
      setError(null)
      onCount?.(j.length)
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : t('agent.loadFailed'))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [t, onCount])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Poll only while something is actually in flight — no busy-wait on an idle board.
  const hasLive = useMemo(
    () =>
      jobs.some((j) => JOB_IN_PROGRESS.includes(j.status)) ||
      deployments.some((d) => DEPLOYMENT_IN_PROGRESS.includes(d.status)),
    [jobs, deployments],
  )
  /** Newest deployment per job, so a job row can show the version it shipped.
   *  The list arrives newest-first, so the first hit for a job wins. */
  const depByJob = useMemo(() => {
    const map = new Map<number, Deployment>()
    for (const d of deployments) {
      if (d.job_id !== null && !map.has(d.job_id)) map.set(d.job_id, d)
    }
    return map
  }, [deployments])

  useEffect(() => {
    if (!hasLive) return
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [hasLive, refresh])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!prompt.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await createJob({ prompt: prompt.trim() })
      setPrompt('')
      setNewOpen(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agent.createFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  /** Every row action shares the same busy/refresh/error handling. */
  async function act(id: number, fn: () => Promise<unknown>, fallback: string) {
    setBusyId(id)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
    } finally {
      setBusyId(null)
    }
  }

  async function onAnswer(e: FormEvent) {
    e.preventDefault()
    if (!answerFor || !answer.trim()) return
    const job = answerFor
    const text = answer.trim()
    setAnswerFor(null)
    setAnswer('')
    await act(job.id, () => answerJob(job.id, text), t('agent.answerFailed'))
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>

  const canSubmit =
    canRun &&
    !!config?.repo_full_name &&
    !!config?.has_token &&
    !!config?.agent.configured &&
    prompt.trim().length >= 5

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {config && <SetupNotice config={config} />}

      {/* ── Jobs ────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('development.refresh')}
          </Button>
          {canRun && (
            <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('agent.newJob')}
            </Button>
          )}
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agent.colJob')}</TableHead>
                <TableHead>{t('agent.colStartedBy')}</TableHead>
                <TableHead>{t('agent.colAgent')}</TableHead>
                <TableHead>{t('agent.colStatus')}</TableHead>
                <TableHead>{t('agent.colPr')}</TableHead>
                <TableHead>{t('agent.colDeployed')}</TableHead>
                <TableHead>{t('agent.colCreated')}</TableHead>
                <TableHead className="text-right">{t('development.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableEmptyState
                  colSpan={8}
                  icon={Bot}
                  title={t('agent.jobsEmptyTitle')}
                  description={t('agent.jobsEmpty')}
                />
              ) : (
                jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="max-w-sm">
                      <button
                        type="button"
                        className="truncate text-left font-medium hover:underline"
                        onClick={() =>
                          void getJob(job.id)
                            .then(setDetail)
                            .catch((e) =>
                              setError(e instanceof Error ? e.message : t('agent.loadFailed')),
                            )
                        }
                      >
                        {job.title}
                      </button>
                      {job.error && (
                        <div className="truncate text-xs text-destructive">{job.error}</div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {job.created_by_name ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {t(`agent.agent_${job.agent}`)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell>
                      <PrLink number={job.pr_number} url={job.pr_url} />
                    </TableCell>
                    <TableCell>
                      <DeployedCell dep={depByJob.get(job.id)} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmt(job.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {job.status === 'answer_pending' && canRun && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busyId === job.id}
                            onClick={() => {
                              setAnswerFor(job)
                              setAnswer('')
                            }}
                          >
                            <MessageCircleQuestion className="mr-2 h-4 w-4" />
                            {t('agent.answer')}
                          </Button>
                        )}
                        {job.status === 'deployment_ready' && canDeploy && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={busyId === job.id || !config?.deploy_enabled}
                            title={config?.deploy_enabled ? undefined : t('agent.deployDisabled')}
                            onClick={() =>
                              void act(job.id, () => deployJob(job.id), t('agent.deployFailed'))
                            }
                          >
                            <Rocket className="mr-2 h-4 w-4" />
                            {t('agent.deploy')}
                          </Button>
                        )}
                        {(job.status === 'failed' || job.status === 'cancelled') && canRun && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busyId === job.id}
                            onClick={() =>
                              void act(job.id, () => retryJob(job.id), t('agent.retryFailed'))
                            }
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            {t('agent.retry')}
                          </Button>
                        )}
                        {JOB_IN_PROGRESS.includes(job.status) &&
                          job.status !== 'deploying' &&
                          canRun && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busyId === job.id}
                              onClick={() =>
                                void act(job.id, () => cancelJob(job.id), t('agent.cancelFailed'))
                              }
                            >
                              <Ban className="mr-2 h-4 w-4" />
                              {t('common.cancel')}
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── New job ─────────────────────────────────────────────────────── */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <form onSubmit={onCreate}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="h-4 w-4" />
                {t('agent.newJob')}
                {config?.agent.configured && (
                  <Badge variant="secondary">
                    {config.agent.label}
                    {config.agent.model ? ` · ${config.agent.model}` : ''}
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>{t('agent.newJobHint')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="job-prompt">{t('agent.prompt')}</Label>
              <Textarea
                id="job-prompt"
                value={prompt}
                rows={8}
                placeholder={t('agent.promptPlaceholder')}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('agent.titleGenerated')}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!canSubmit || submitting}>
                {submitting ? t('agent.starting') : t('agent.start')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Answer the agent's question ─────────────────────────────────── */}
      <Dialog open={answerFor !== null} onOpenChange={(o) => !o && setAnswerFor(null)}>
        <DialogContent>
          <form onSubmit={onAnswer}>
            <DialogHeader>
              <DialogTitle>{t('agent.answerTitle')}</DialogTitle>
              <DialogDescription>{t('agent.answerHint')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="whitespace-pre-line rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {answerFor?.question}
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-answer">{t('agent.yourAnswer')}</Label>
                <Textarea
                  id="job-answer"
                  rows={5}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAnswerFor(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!answer.trim()}>
                {t('agent.sendAnswer')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Job detail ──────────────────────────────────────────────────── */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>
              {detail &&
                [
                  t(`agent.agent_${detail.agent}`),
                  t(`agent.status_${detail.status}`),
                  detail.created_by_name && `${t('agent.startedBy')} ${detail.created_by_name}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t('agent.prompt')}</p>
              <p className="whitespace-pre-line rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {detail?.prompt}
              </p>
            </div>
            {detail?.events?.length ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t('agent.timeline')}</p>
                <ul className="space-y-2">
                  {detail.events.map((ev) => (
                    <li key={ev.id} className="flex gap-3 text-sm">
                      <span className="w-36 shrink-0 text-xs text-muted-foreground">
                        {fmt(ev.created_at)}
                      </span>
                      <span className="whitespace-pre-line">{ev.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {detail?.log && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t('agent.log')}</p>
                <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">
                  {detail.log}
                </pre>
              </div>
            )}
          </div>
          <DialogFooter>
            {detail?.pr_url && (
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(detail.pr_url!, '_blank', 'noopener,noreferrer')}
              >
                {t('agent.openPr')}
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            )}
            <Button type="button" onClick={() => setDetail(null)}>
              {t('agent.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  GitPullRequest,
  MessageCircleQuestion,
  RefreshCw,
  Rocket,
  Ban,
  RotateCcw,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from '@/i18n'
import { usePermissions } from '@/context/PermissionsContext'
import {
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

/** Statuses where something is still moving, so the list keeps polling. */
const LIVE: JobStatus[] = ['pending', 'running', 'deploying']
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
    <Badge variant={STATUS_VARIANT[status]} className={STATUS_CLASS[status]}>
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
    <div className="flex gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="space-y-1">
        <ul className="list-inside list-disc space-y-0.5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <Link to="/settings/app?tab=development" className="text-primary hover:underline">
          {t('agent.setupLink')}
        </Link>
      </div>
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

  const [title, setTitle] = useState('')
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
      jobs.some((j) => LIVE.includes(j.status)) ||
      deployments.some((d) => d.status === 'pending' || d.status === 'merging' || d.status === 'deploying'),
    [jobs, deployments],
  )
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
      await createJob({ title: title.trim() || undefined, prompt: prompt.trim() })
      setTitle('')
      setPrompt('')
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

      {/* ── New job ─────────────────────────────────────────────────────── */}
      {canRun && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4" />
              {t('agent.newJob')}
              {config?.agent.configured && (
                <Badge variant="secondary">
                  {config.agent.label}
                  {config.agent.model ? ` · ${config.agent.model}` : ''}
                </Badge>
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t('agent.newJobHint')}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="job-title">{t('agent.jobTitle')}</Label>
                <Input
                  id="job-title"
                  value={title}
                  placeholder={t('agent.jobTitlePlaceholder')}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-prompt">{t('agent.prompt')}</Label>
                <Textarea
                  id="job-prompt"
                  value={prompt}
                  rows={6}
                  placeholder={t('agent.promptPlaceholder')}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={!canSubmit || submitting}>
                {submitting ? t('agent.starting') : t('agent.start')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Jobs ────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t('agent.jobsTitle')}</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('development.refresh')}
          </Button>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agent.colJob')}</TableHead>
                <TableHead>{t('agent.colAgent')}</TableHead>
                <TableHead>{t('agent.colStatus')}</TableHead>
                <TableHead>{t('agent.colPr')}</TableHead>
                <TableHead>{t('agent.colCreated')}</TableHead>
                <TableHead className="text-right">{t('development.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableEmptyState
                  colSpan={6}
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
                      {job.created_by_name && (
                        <div className="truncate text-xs text-muted-foreground">
                          {job.created_by_name}
                        </div>
                      )}
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
                        {LIVE.includes(job.status) && job.status !== 'deploying' && canRun && (
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

      {/* ── Deployment history ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium">{t('agent.deploymentsTitle')}</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agent.colVersion')}</TableHead>
                <TableHead>{t('agent.colChange')}</TableHead>
                <TableHead>{t('agent.colStatus')}</TableHead>
                <TableHead>{t('agent.colBy')}</TableHead>
                <TableHead>{t('agent.colDeployedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.length === 0 ? (
                <TableEmptyState
                  colSpan={5}
                  icon={Rocket}
                  title={t('agent.deploymentsEmptyTitle')}
                  description={t('agent.deploymentsEmpty')}
                />
              ) : (
                deployments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <PrLink number={d.pr_number} url={d.pr_url} />
                      {d.merge_sha && (
                        <div className="font-mono text-xs text-muted-foreground">
                          {d.merge_sha.slice(0, 8)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <div className="truncate">{d.job_title ?? '—'}</div>
                      {d.error && <div className="truncate text-xs text-destructive">{d.error}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={d.status === 'failed' ? 'destructive' : 'secondary'}
                        className={d.status === 'deployed' ? 'bg-green-600 hover:bg-green-600' : undefined}
                      >
                        {t(`agent.deployStatus_${d.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {d.deployed_by_name ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmt(d.finished_at ?? d.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

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
              {detail && `${t(`agent.agent_${detail.agent}`)} · ${t(`agent.status_${detail.status}`)}`}
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

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Bot,
  Download,
  ExternalLink,
  GitPullRequest,
  MessageCircleQuestion,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  GitMerge,
  Rocket,
  Ban,
  RotateCcw,
  X,
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
  createRelease,
  downloadJobFile,
  fetchJobFile,
  getDevConfig,
  getJob,
  listReleases,
  requestMerge,
  listJobs,
  retryJob,
  updateJobPrompt,
  MAX_JOB_FILES,
  MAX_JOB_FILE_BYTES,
  MAX_JOB_FILES_TOTAL_BYTES,
  type Release,
  type DevConfig,
  type Job,
  type JobDetail,
  type JobFile,
  type JobStatus,
} from '@/lib/development'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
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

/** One soft tint per status, so the stage is readable at a glance without any
 *  heavy fills. Dark mode uses a low-opacity wash of the same hue rather than a
 *  darker block, keeping the labels light in both themes. */
const STATUS_CLASS: Record<JobStatus, string> = {
  pending:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:border-slate-400/25',
  running:
    'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-400/15 dark:text-blue-300 dark:border-blue-400/25',
  answer_pending:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:border-amber-400/25',
  merged:
    'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-400/15 dark:text-teal-300 dark:border-teal-400/25',
  deployment_ready:
    'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-400/15 dark:text-violet-300 dark:border-violet-400/25',
  deploying:
    'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-400/15 dark:text-sky-300 dark:border-sky-400/25',
  deployed:
    'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:border-emerald-400/25',
  failed:
    'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-400/15 dark:text-rose-300 dark:border-rose-400/25',
  cancelled:
    'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-400/15 dark:text-zinc-400 dark:border-zinc-400/25',
}

/** The board is split in two: work on its way to production, and work that got
 *  there. Each table drops the columns the other one needs. */
type JobsVariant = 'pending' | 'deployed'

function fmt(dt: string | null): string {
  if (!dt) return '—'
  const d = new Date(dt)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** Sub-cent runs are common, so don't round them away to "$0.00". */
function fmtCost(usd: number): string {
  if (!usd) return '—'
  return usd < 0.01 ? `<$0.01` : `$${usd.toFixed(2)}`
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Cost of a job, with the merge-conflict share called out — a job that cost
 *  most of its money getting past a stale branch is worth seeing. */
function CostCell({ job }: { job: Job }) {
  const { t } = useTranslation()
  if (!job.cost_usd) return <span className="text-muted-foreground">—</span>
  return (
    <div
      className="whitespace-nowrap"
      title={t('agent.costTooltip', {
        input: fmtTokens(job.input_tokens),
        output: fmtTokens(job.output_tokens),
        cached: fmtTokens(job.cache_read_tokens),
      })}
    >
      <div className="text-xs font-medium tabular-nums">{fmtCost(job.cost_usd)}</div>
      {job.merge_cost_usd > 0 && (
        <div className="text-xs text-muted-foreground">
          {t('agent.costMerge', { amount: fmtCost(job.merge_cost_usd) })}
        </div>
      )}
    </div>
  )
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function JobStatusBadge({ status }: { status: JobStatus }) {
  const { t } = useTranslation()
  return (
    <StatusBadge
      label={t(`agent.status_${status}`)}
      active={JOB_IN_PROGRESS.includes(status)}
      className={STATUS_CLASS[status]}
    />
  )
}

/** PR number as a neutral grey label — the same pill shape as the status column,
 *  so the cell reads as a value rather than loose text. It links straight to
 *  GitHub whenever we know the URL. */
function PrLink({ number, url }: { number: number | null; url: string | null }) {
  if (number === null) return <span className="text-muted-foreground">—</span>
  const label = (
    <Badge variant="secondary" className="gap-1 font-medium tabular-nums">
      <GitPullRequest className="h-3.5 w-3.5 shrink-0" />
      {`#${number}`}
      {url && <ExternalLink className="h-3 w-3 shrink-0" />}
    </Badge>
  )
  if (!url) return label
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex">
      {label}
    </a>
  )
}

/** The release that shipped this job — several functions share one. Empty for
 *  anything not deployed yet. */
function DeployedCell({ release }: { release: Release | undefined }) {
  if (!release) return <span className="text-muted-foreground">—</span>
  return (
    <div className="whitespace-nowrap">
      <div className="text-xs font-medium">{release.version_label ?? '—'}</div>
      <div className="text-xs text-muted-foreground">
        {[release.deployed_by_name, fmt(release.finished_at ?? release.created_at)]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </div>
  )
}

/** One file waiting to be uploaded, previewed so the right screenshot is sent. */
function PickedFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <li className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm">
      {preview ? (
        <img src={preview} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(file.size)}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        title={t('agent.removeFile')}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}

/** The attach button plus the list of files picked so far, shared by the prompt
 *  and answer dialogs. Ceilings are checked here as well as in the API, so an
 *  oversized screenshot fails instantly instead of after the upload. */
function AttachmentPicker({
  files,
  onChange,
}: {
  files: File[]
  onChange: (files: File[]) => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    setError(null)

    const tooBig = picked.find((f) => f.size > MAX_JOB_FILE_BYTES)
    if (tooBig) {
      setError(t('agent.fileTooLarge', { name: tooBig.name, size: fmtSize(MAX_JOB_FILE_BYTES) }))
      return
    }
    const next = [...files, ...picked]
    if (next.length > MAX_JOB_FILES) {
      setError(t('agent.tooManyFiles', { max: MAX_JOB_FILES }))
      return
    }
    if (next.reduce((sum, f) => sum + f.size, 0) > MAX_JOB_FILES_TOTAL_BYTES) {
      setError(t('agent.filesTooLarge', { size: fmtSize(MAX_JOB_FILES_TOTAL_BYTES) }))
      return
    }
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{t('agent.attachments')}</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Paperclip className="mr-2 h-4 w-4" />
          {t('agent.attach')}
        </Button>
      </div>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={onPick} />
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <PickedFile
              key={`${file.name}-${index}`}
              file={file}
              onRemove={() => {
                setError(null)
                onChange(files.filter((_, i) => i !== index))
              }}
            />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          t('agent.attachHint', { max: MAX_JOB_FILES, size: fmtSize(MAX_JOB_FILE_BYTES) })
        )}
      </p>
    </div>
  )
}

/** An attachment already stored with the job. The route is authenticated, so
 *  both the thumbnail and the download go through fetch, not a plain href. */
function StoredFile({ jobId, file }: { jobId: number; file: JobFile }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file.mime?.startsWith('image/')) return
    let url: string | null = null
    let cancelled = false
    void fetchJobFile(jobId, file.id)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setPreview(url)
      })
      // A missing thumbnail is not worth an error banner; the download still works.
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [jobId, file.id, file.mime])

  return (
    <li className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm">
      {preview ? (
        <img src={preview} alt={file.name} className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(file.size)}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        title={t('agent.downloadFile')}
        onClick={() => void downloadJobFile(jobId, file)}
      >
        <Download className="h-3.5 w-3.5" />
      </Button>
    </li>
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
  // A single problem reads as a sentence, not a list: centre it against the icon
  // and the button, and drop the lone bullet. Several problems stay a top-aligned
  // bulleted list so the icon sits with the first line.
  const single = problems.length === 1
  return (
    <div
      className={cn(
        'flex flex-wrap justify-between gap-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm',
        single ? 'items-center' : 'items-start',
      )}
    >
      <div className={cn('flex gap-3', single && 'items-center')}>
        <AlertTriangle
          className={cn(
            'h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500',
            !single && 'mt-0.5',
          )}
        />
        {single ? (
          <span>{problems[0]}</span>
        ) : (
          <ul className="list-inside list-disc space-y-0.5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
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
  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newOpen, setNewOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)

  const [editFor, setEditFor] = useState<Job | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [answerFor, setAnswerFor] = useState<Job | null>(null)
  const [answer, setAnswer] = useState('')
  const [answerFiles, setAnswerFiles] = useState<File[]>([])
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [releasing, setReleasing] = useState(false)

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
      const [c, j, d] = await Promise.all([getDevConfig(), listJobs(), listReleases()])
      if (!mounted.current) return
      setConfig(c)
      setJobs(j)
      setReleases(d)
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
      releases.some((r) => DEPLOYMENT_IN_PROGRESS.includes(r.status)),
    [jobs, releases],
  )
  /** Release lookup, so a job row can name the version that shipped it. */
  const releaseById = useMemo(
    () => new Map(releases.map((r) => [r.id, r])),
    [releases],
  )
  /** Merged and waiting: the batch the next release would ship. */
  const readyCount = useMemo(() => jobs.filter((j) => j.status === 'merged').length, [jobs])
  /** Everything still on its way to production — including the jobs that failed
   *  or were cancelled, so nothing quietly disappears from the board. */
  const pendingJobs = useMemo(() => jobs.filter((j) => j.status !== 'deployed'), [jobs])
  const deployedJobs = useMemo(() => jobs.filter((j) => j.status === 'deployed'), [jobs])

  useEffect(() => {
    if (!hasLive) return
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [hasLive, refresh])

  function closeNew() {
    setNewOpen(false)
    setFiles([])
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!prompt.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await createJob({ prompt: prompt.trim(), files })
      setPrompt('')
      closeNew()
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

  function closeAnswer() {
    setAnswerFor(null)
    setAnswer('')
    setAnswerFiles([])
  }

  /** Ship every merged function in one rebuild. */
  async function onRelease() {
    setReleasing(true)
    setError(null)
    try {
      await createRelease()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agent.releaseFailed'))
    } finally {
      setReleasing(false)
    }
  }

  async function onEdit(e: FormEvent) {
    e.preventDefault()
    if (!editFor || !editPrompt.trim()) return
    const job = editFor
    const text = editPrompt.trim()
    setEditFor(null)
    await act(job.id, () => updateJobPrompt(job.id, text), t('agent.editFailed'))
  }

  async function onAnswer(e: FormEvent) {
    e.preventDefault()
    if (!answerFor || !answer.trim()) return
    const job = answerFor
    const text = answer.trim()
    const attached = answerFiles
    closeAnswer()
    await act(job.id, () => answerJob(job.id, text, attached), t('agent.answerFailed'))
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>

  const canSubmit =
    canRun &&
    !!config?.repo_full_name &&
    !!config?.has_token &&
    !!config?.agent.configured &&
    prompt.trim().length >= 5

  /** One job row. The two tables share it because the columns they don't have
   *  in common are exactly the ones that are dead weight on the other side:
   *  a shipped job has no action left to take, and an unshipped one has no
   *  release to name. */
  function jobRow(job: Job, variant: JobsVariant) {
    return (
      <TableRow key={job.id}>
        <TableCell className="max-w-sm">
          <button
            type="button"
            className="truncate text-left font-medium hover:underline"
            onClick={() =>
              void getJob(job.id)
                .then(setDetail)
                .catch((e) => setError(e instanceof Error ? e.message : t('agent.loadFailed')))
            }
          >
            {job.title}
          </button>
          {job.files.length > 0 && (
            <span
              className="ml-2 inline-flex items-center gap-1 align-middle text-xs text-muted-foreground"
              title={job.files.map((f) => f.name).join(', ')}
            >
              <Paperclip className="h-3 w-3" />
              {job.files.length}
            </span>
          )}
          {job.error && <div className="truncate text-xs text-destructive">{job.error}</div>}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {job.created_by_name ?? '—'}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {t(`agent.agent_${job.agent}`)}
        </TableCell>
        {variant === 'pending' && (
          <TableCell>
            <JobStatusBadge status={job.status} />
          </TableCell>
        )}
        <TableCell>
          <PrLink number={job.pr_number} url={job.pr_url} />
        </TableCell>
        {variant === 'deployed' && (
          <TableCell>
            <DeployedCell release={job.release_id ? releaseById.get(job.release_id) : undefined} />
          </TableCell>
        )}
        <TableCell>
          <CostCell job={job} />
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {fmt(job.created_at)}
        </TableCell>
        {variant === 'pending' && (
          <TableCell className="text-right">
            <div className="flex justify-end gap-2">
              {job.status === 'pending' && canRun && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId === job.id}
                  onClick={() => {
                    setEditFor(job)
                    setEditPrompt(job.prompt)
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {t('common.edit')}
                </Button>
              )}
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
              {job.status === 'deployment_ready' && canRun && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId === job.id || !config?.deploy_enabled}
                  title={config?.deploy_enabled ? undefined : t('agent.deployDisabled')}
                  onClick={() =>
                    void act(job.id, () => requestMerge(job.id), t('agent.mergeFailed'))
                  }
                >
                  <GitMerge className="mr-2 h-4 w-4" />
                  {t('agent.retryMerge')}
                </Button>
              )}
              {(job.status === 'failed' || job.status === 'cancelled') && canRun && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId === job.id}
                  onClick={() => void act(job.id, () => retryJob(job.id), t('agent.retryFailed'))}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('agent.retry')}
                </Button>
              )}
              {JOB_IN_PROGRESS.includes(job.status) && job.status !== 'deploying' && canRun && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busyId === job.id}
                  onClick={() => void act(job.id, () => cancelJob(job.id), t('agent.cancelFailed'))}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </TableCell>
        )}
      </TableRow>
    )
  }

  function jobsTable(variant: JobsVariant, rows: Job[], emptyTitle: string, empty: string) {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('agent.colJob')}</TableHead>
              <TableHead>{t('agent.colStartedBy')}</TableHead>
              <TableHead>{t('agent.colAgent')}</TableHead>
              {variant === 'pending' && <TableHead>{t('agent.colStatus')}</TableHead>}
              <TableHead>{t('agent.colPr')}</TableHead>
              {variant === 'deployed' && <TableHead>{t('agent.colDeployed')}</TableHead>}
              <TableHead>{t('agent.colCost')}</TableHead>
              <TableHead>{t('agent.colCreated')}</TableHead>
              {variant === 'pending' && (
                <TableHead className="text-right">{t('development.colActions')}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmptyState
                colSpan={variant === 'pending' ? 8 : 7}
                icon={variant === 'pending' ? Bot : Rocket}
                title={emptyTitle}
                description={empty}
              />
            ) : (
              rows.map((job) => jobRow(job, variant))
            )}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {config && <SetupNotice config={config} />}

      {/* Merged work waits here until someone ships it — one rebuild for the
          whole batch, rather than one per function. */}
      {readyCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-teal-500/50 bg-teal-500/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <Rocket className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
            <span>
              {t('agent.readyCount', { count: readyCount })}
              <span className="ml-1 text-muted-foreground">{t('agent.readyHint')}</span>
            </span>
          </div>
          {canDeploy && (
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              disabled={releasing || !config?.deploy_enabled}
              title={config?.deploy_enabled ? undefined : t('agent.deployDisabled')}
              onClick={() => void onRelease()}
            >
              <Rocket className="mr-2 h-4 w-4" />
              {releasing ? t('agent.deploying') : t('agent.deployAll', { count: readyCount })}
            </Button>
          )}
        </div>
      )}

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

        <p className="text-xs font-medium text-muted-foreground">{t('agent.pendingTitle')}</p>
        {jobsTable('pending', pendingJobs, t('agent.jobsEmptyTitle'), t('agent.jobsEmpty'))}

        <p className="pt-2 text-xs font-medium text-muted-foreground">
          {t('agent.deployedTitle')}
        </p>
        {jobsTable(
          'deployed',
          deployedJobs,
          t('agent.deployedEmptyTitle'),
          t('agent.deployedEmpty'),
        )}
      </div>

      {/* ── New job ─────────────────────────────────────────────────────── */}
      <Dialog open={newOpen} onOpenChange={(o) => (o ? setNewOpen(true) : closeNew())}>
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

              <div className="pt-2">
                <AttachmentPicker files={files} onChange={setFiles} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeNew}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!canSubmit || submitting}>
                {submitting ? t('agent.starting') : t('agent.start')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit a pending job ──────────────────────────────────────────── */}
      <Dialog open={editFor !== null} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent>
          <form onSubmit={onEdit}>
            <DialogHeader>
              <DialogTitle>{t('agent.editTitle')}</DialogTitle>
              <DialogDescription>{t('agent.editHint')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="edit-prompt">{t('agent.prompt')}</Label>
              <Textarea
                id="edit-prompt"
                rows={8}
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditFor(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!editPrompt.trim()}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Answer the agent's question ─────────────────────────────────── */}
      <Dialog open={answerFor !== null} onOpenChange={(o) => !o && closeAnswer()}>
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
              <AttachmentPicker files={answerFiles} onChange={setAnswerFiles} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeAnswer}>
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
            {detail && detail.files.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('agent.attachments')}
                </p>
                <ul className="space-y-1">
                  {detail.files.map((file) => (
                    <StoredFile key={file.id} jobId={detail.id} file={file} />
                  ))}
                </ul>
              </div>
            )}
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

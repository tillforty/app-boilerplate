import { api, apiBlob } from './api'

/** Per-requirement flags for the Development › Issues setup checklist. */
export interface DevSetupStatus {
  glitchtip_enabled: boolean
  capture_configured: boolean
  api_token_configured: boolean
  org_slug_configured: boolean
  project_slug_configured: boolean
  api_configured: boolean
  environment: string
  ui_url: string | null
}

/** A single error group from the tracker (GlitchTip/Sentry). */
export interface Issue {
  id: string
  short_id: string | null
  title: string
  culprit: string | null
  level: string | null
  status: string | null
  count: number
  user_count: number
  first_seen: string | null
  last_seen: string | null
  web_url: string | null
}

export interface IssueList {
  configured: boolean
  issues: Issue[]
}

export const getDevSetup = () => api.get<DevSetupStatus>('/development/setup')

export const listIssues = (query?: string, limit = 50) => {
  const params = new URLSearchParams()
  if (query) params.set('query', query)
  params.set('limit', String(limit))
  return api.get<IssueList>(`/development/issues?${params.toString()}`)
}

export const resolveIssue = (issueId: string) =>
  api.post<void>(`/development/issues/${issueId}/resolve`, {})

export const createJobFromIssue = (issueId: string) =>
  api.post<Job>(`/development/issues/${issueId}/job`, {})

// ── Development agent ───────────────────────────────────────────────────────

/** Job lifecycle. `answer_pending` and `deployment_ready` are the two states
 *  that wait on a human; everything else advances on its own. */
export type JobStatus =
  | 'pending'
  | 'running'
  | 'answer_pending'
  /** Merged into the base branch, waiting for the next release. */
  | 'merged'
  /** PR is open but the automatic merge did not succeed — needs a human. */
  | 'deployment_ready'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'cancelled'

/** Statuses where the pipeline is still working — the list keeps polling and the
 *  status label spins. Kept here so every view agrees on what "in progress" is. */
export const JOB_IN_PROGRESS: JobStatus[] = ['pending', 'running', 'deploying']

/** Which coding CLI is bound, per Settings › App › AI functions. */
export interface AgentInfo {
  configured: boolean
  agent: 'claude_code' | 'codex' | null
  label: string | null
  provider: string | null
  model: string | null
  /** Why it isn't usable: 'unbound' | 'no_key' | 'unsupported_provider'. */
  reason: string | null
}

export interface ValidationCheck {
  key: string
  ok: boolean
  detail: string
}

export interface ValidationResult {
  ok: boolean
  checks: ValidationCheck[]
}

export interface DevConfig {
  repo_full_name: string | null
  base_branch: string
  checkout_path: string
  deploy_enabled: boolean
  has_token: boolean
  validation: ValidationResult | null
  validated_at: string | null
  runner_online: boolean
  runner_seen_at: string | null
  runner_info: Record<string, unknown> | null
  agent: AgentInfo
}

export interface DevConfigUpdate {
  repo_full_name?: string | null
  base_branch?: string
  checkout_path?: string
  deploy_enabled?: boolean
  /** Non-empty stores/rotates the token; omit to keep the existing one. */
  github_token?: string
  clear_token?: boolean
}

export interface JobEvent {
  id: number
  kind: string
  message: string
  created_at: string
}

/** A screenshot or file the requester attached to a job's prompt or answer. */
export interface JobFile {
  id: number
  name: string
  mime: string | null
  size: number
}

/** Attachment ceilings, mirrored from devagent.py so the picker can reject
 *  oversized files before a pointless upload. */
export const MAX_JOB_FILES = 10
export const MAX_JOB_FILE_BYTES = 10 * 1024 * 1024
export const MAX_JOB_FILES_TOTAL_BYTES = 25 * 1024 * 1024

export interface Job {
  id: number
  title: string
  prompt: string
  agent: string
  model: string | null
  status: JobStatus
  branch: string | null
  pr_number: number | null
  pr_url: string | null
  commit_sha: string | null
  question: string | null
  error: string | null
  attempts: number
  files: JobFile[]
  merged_at: string | null
  release_id: number | null
  /** What the job cost to complete, summed over every CLI run it took.
   *  `merge_cost_usd` is the slice spent resolving conflicts — a subset of
   *  `cost_usd`, not an addition to it. */
  cost_usd: number
  merge_cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  created_by_name: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface JobDetail extends Job {
  log: string | null
  events: JobEvent[]
}

export type DeploymentStatus = 'pending' | 'merging' | 'deploying' | 'deployed' | 'failed'

/** Deployment counterpart of {@link JOB_IN_PROGRESS}. */
export const DEPLOYMENT_IN_PROGRESS: DeploymentStatus[] = ['pending', 'merging', 'deploying']

/** One function carried by a release. */
export interface ReleaseJob {
  id: number
  title: string
  pr_number: number | null
  pr_url: string | null
}

/** A release ships every merged function in a single rebuild. */
export interface Release {
  id: number
  release_number: number | null
  version_label: string | null
  status: DeploymentStatus
  job_count: number
  jobs: ReleaseJob[]
  error: string | null
  deployed_by_name: string | null
  created_at: string
  finished_at: string | null
}

export const getDevConfig = () => api.get<DevConfig>('/development/config')
export const updateDevConfig = (body: DevConfigUpdate) =>
  api.put<DevConfig>('/development/config', body)
export const validateDevConfig = () =>
  api.post<DevConfig>('/development/config/validate', {})

export const listJobs = (limit = 50) => api.get<Job[]>(`/development/jobs?limit=${limit}`)
export const getJob = (id: number) => api.get<JobDetail>(`/development/jobs/${id}`)
/** The title is written by the operating agent from the prompt, not supplied.
 *  Sent as multipart so the prompt and its attachments arrive together — the
 *  runner may claim the job seconds later. */
export const createJob = (body: { prompt: string; files?: File[] }) => {
  const form = new FormData()
  form.append('prompt', body.prompt)
  for (const file of body.files ?? []) form.append('files', file)
  return api.upload<Job>('/development/jobs', form)
}
/** Attachment bytes. Fetched rather than linked, since the route is authenticated. */
export const fetchJobFile = (jobId: number, fileId: number) =>
  apiBlob(`/development/jobs/${jobId}/files/${fileId}`)
export async function downloadJobFile(jobId: number, file: JobFile): Promise<void> {
  const url = URL.createObjectURL(await fetchJobFile(jobId, file.id))
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  URL.revokeObjectURL(url)
}
/** Reword a job that hasn't started. Pending only; the title is regenerated. */
export const updateJobPrompt = (id: number, prompt: string) =>
  api.patch<Job>(`/development/jobs/${id}`, { prompt })
/** Answers can carry attachments too — the agent often asks about a screen. */
export const answerJob = (id: number, answer: string, files: File[] = []) => {
  const form = new FormData()
  form.append('answer', answer)
  for (const file of files) form.append('files', file)
  return api.upload<Job>(`/development/jobs/${id}/answer`, form)
}
/** Remove a job and its events/attachments. Rejected while it is in flight. */
export const deleteJob = (id: number) => api.delete<void>(`/development/jobs/${id}`)
export const retryJob = (id: number) => api.post<Job>(`/development/jobs/${id}/retry`, {})
export const cancelJob = (id: number) => api.post<Job>(`/development/jobs/${id}/cancel`, {})
/** Retry an auto-merge that failed; merging is otherwise automatic. */
export const requestMerge = (id: number) =>
  api.post<Job>(`/development/jobs/${id}/merge`, {})

/** Ship everything merged-but-not-deployed in one rebuild. */
export const createRelease = () => api.post<Release>('/development/releases', {})

export const listReleases = (limit = 50) =>
  api.get<Release[]>(`/development/releases?limit=${limit}`)

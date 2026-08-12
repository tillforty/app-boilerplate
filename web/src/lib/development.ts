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

// ── Development agent ───────────────────────────────────────────────────────

/** Job lifecycle. `answer_pending` and `deployment_ready` are the two states
 *  that wait on a human; everything else advances on its own. */
export type JobStatus =
  | 'pending'
  | 'running'
  | 'answer_pending'
  | 'deployment_ready'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'cancelled'

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
  created_by_name: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface JobDetail extends Job {
  log: string | null
  events: JobEvent[]
}

export interface Deployment {
  id: number
  job_id: number | null
  job_title: string | null
  pr_number: number | null
  pr_url: string | null
  merge_sha: string | null
  version_label: string | null
  status: 'pending' | 'merging' | 'deploying' | 'deployed' | 'failed'
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
/** Answers can carry attachments too — the agent often asks about a screen. */
export const answerJob = (id: number, answer: string, files: File[] = []) => {
  const form = new FormData()
  form.append('answer', answer)
  for (const file of files) form.append('files', file)
  return api.upload<Job>(`/development/jobs/${id}/answer`, form)
}
export const retryJob = (id: number) => api.post<Job>(`/development/jobs/${id}/retry`, {})
export const cancelJob = (id: number) => api.post<Job>(`/development/jobs/${id}/cancel`, {})
export const deployJob = (id: number) =>
  api.post<Deployment>(`/development/jobs/${id}/deploy`, {})

export const listDeployments = (limit = 50) =>
  api.get<Deployment[]>(`/development/deployments?limit=${limit}`)

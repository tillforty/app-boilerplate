import { api } from './api'

/** Per-requirement flags for the Settings › Operations setup checklist. */
export interface OpsSetupStatus {
  base_url_configured: boolean
  api_key_configured: boolean
  api_configured: boolean
  ui_url: string | null
}

/** One n8n workflow run. `duration_ms` is null while it is still going. */
export interface Execution {
  id: string
  workflow_id: string | null
  workflow_name: string | null
  status: string | null
  mode: string | null
  finished: boolean
  retry_of: string | null
  started_at: string | null
  stopped_at: string | null
  duration_ms: number | null
  web_url: string | null
}

export interface ExecutionList {
  configured: boolean
  executions: Execution[]
  /** Opaque cursor for the next page; null on the last one. */
  next_cursor: string | null
}

export interface Workflow {
  id: string
  name: string
  active: boolean
}

/** The states n8n reports, in the order the filter offers them. */
export const EXECUTION_STATUSES = [
  'success',
  'error',
  'waiting',
  'running',
  'canceled',
  'new',
] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export const getOpsSetup = () => api.get<OpsSetupStatus>('/operations/setup')

export const listExecutions = (opts: {
  status?: ExecutionStatus | null
  workflowId?: string | null
  cursor?: string | null
  limit?: number
} = {}) => {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.workflowId) params.set('workflow_id', opts.workflowId)
  if (opts.cursor) params.set('cursor', opts.cursor)
  params.set('limit', String(opts.limit ?? 50))
  return api.get<ExecutionList>(`/operations/executions?${params.toString()}`)
}

export const listWorkflows = () => api.get<Workflow[]>('/operations/workflows')

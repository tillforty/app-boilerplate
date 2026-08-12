import { api } from './api'

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

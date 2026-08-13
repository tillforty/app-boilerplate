import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Circle, ExternalLink, RefreshCw } from 'lucide-react'
import { useTabParam } from '@/lib/use-tab-param'
import { usePermissions } from '@/context/PermissionsContext'
import { useTranslation } from '@/i18n'
import {
  getDevSetup,
  listIssues,
  type DevSetupStatus,
  type Issue,
} from '@/lib/development'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableEmptyState } from '@/components/ui/table-empty-state'
import AgentTab from '@/components/development/AgentTab'

const TABS = ['agent', 'issues', 'support'] as const
type Tab = (typeof TABS)[number]

/** Coming-soon placeholder for the Agent/Support tabs. */
function ComingSoon() {
  const { t } = useTranslation()
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          {t('development.comingSoon')}
        </span>
        <p className="text-sm text-muted-foreground">{t('development.comingSoonHint')}</p>
      </CardContent>
    </Card>
  )
}

function levelClass(level: string | null): string {
  switch (level) {
    case 'fatal':
    case 'error':
      return 'text-destructive'
    case 'warning':
      return 'text-amber-600 dark:text-amber-500'
    default:
      return 'text-muted-foreground'
  }
}

function fmt(dt: string | null): string {
  if (!dt) return '—'
  const d = new Date(dt)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** The setup checklist shown when the issue API isn't wired up yet. */
function SetupChecklist({ setup }: { setup: DevSetupStatus }) {
  const { t } = useTranslation()
  const steps = [
    { done: setup.glitchtip_enabled, title: t('development.step1Title'), desc: t('development.step1Desc') },
    { done: setup.capture_configured, title: t('development.step2Title'), desc: t('development.step2Desc') },
    { done: setup.api_token_configured, title: t('development.step3Title'), desc: t('development.step3Desc') },
    {
      done: setup.org_slug_configured && setup.project_slug_configured,
      title: t('development.step4Title'),
      desc: t('development.step4Desc'),
    },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('development.setupTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('development.setupIntro')}</p>
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
              {t('development.openGlitchtip')}
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t('development.redeployNote')}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** The live issue list — same table styling as the app's other data tables. */
function IssuesList({
  issues,
  onRefresh,
  uiUrl,
}: {
  issues: Issue[]
  onRefresh: () => void
  uiUrl: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {uiUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(uiUrl, '_blank', 'noopener,noreferrer')}
          >
            {t('development.openGlitchtip')}
            <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('development.refresh')}
        </Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('development.colIssue')}</TableHead>
              <TableHead>{t('development.colLevel')}</TableHead>
              <TableHead className="text-right">{t('development.colEvents')}</TableHead>
              <TableHead className="text-right">{t('development.colUsers')}</TableHead>
              <TableHead>{t('development.colLastSeen')}</TableHead>
              <TableHead className="text-right">{t('development.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.length === 0 ? (
              <TableEmptyState
                colSpan={6}
                icon={CheckCircle2}
                title={t('development.issuesEmptyTitle')}
                description={t('development.issuesEmpty')}
              />
            ) : (
              issues.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="max-w-md">
                    <div className="truncate font-medium">{it.title}</div>
                    {it.culprit && (
                      <div className="truncate text-xs text-muted-foreground">{it.culprit}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={levelClass(it.level)}>
                      {it.level ?? '—'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{it.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{it.user_count}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {fmt(it.last_seen)}
                  </TableCell>
                  <TableCell className="text-right">
                    {it.web_url && (
                      <a
                        href={it.web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-primary hover:underline"
                      >
                        {t('development.open')}
                        <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/** Issues tab body: permission gate → setup checklist → live list.
 *  Presentational — data is fetched by DevelopmentPage so the tab count is
 *  available even while the Issues tab isn't the active one. */
function IssuesTab({
  canView,
  loading,
  error,
  setup,
  issues,
  onRefresh,
}: {
  canView: boolean
  loading: boolean
  error: string | null
  setup: DevSetupStatus | null
  issues: Issue[] | null
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  if (!canView) {
    return <p className="text-sm text-muted-foreground">{t('development.noPermission')}</p>
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        {error}
      </div>
    )
  }
  if (setup && !setup.api_configured) {
    return <SetupChecklist setup={setup} />
  }
  return <IssuesList issues={issues ?? []} onRefresh={onRefresh} uiUrl={setup?.ui_url ?? null} />
}

export default function DevelopmentPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canView = can('roles:manage')
  const canAgent = can('development:read')
  const [tab, setTab] = useTabParam<Tab>(TABS, 'agent')
  const [agentCount, setAgentCount] = useState<number | null>(null)
  // Stable identity so AgentTab's refresh callback doesn't re-fire every render.
  const onAgentCount = useCallback((n: number) => setAgentCount(n), [])

  const [setup, setSetup] = useState<DevSetupStatus | null>(null)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [loading, setLoading] = useState(true)
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
    getDevSetup()
      .then(async (s) => {
        if (!active) return
        setSetup(s)
        if (s.api_configured) {
          const list = await listIssues()
          if (active) setIssues(list.issues)
        } else {
          setIssues(null)
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : t('development.issuesError'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [canView, reloadKey, t])

  // Tab badges. Support is still a placeholder (no data yet) → 0.
  const issuesBadge = issues !== null ? String(issues.length) : ''
  const agentBadge = agentCount !== null ? String(agentCount) : ''

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('development.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('development.subtitle')}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="agent">
            {t('development.tabAgent')}
            {agentBadge !== '' && ` (${agentBadge})`}
          </TabsTrigger>
          <TabsTrigger value="issues">
            {t('development.tabIssues')}
            {issuesBadge !== '' && ` (${issuesBadge})`}
          </TabsTrigger>
          <TabsTrigger value="support">{t('development.tabSupport')} (0)</TabsTrigger>
        </TabsList>
        <TabsContent value="agent">
          {canAgent ? (
            <AgentTab onCount={onAgentCount} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('development.noPermission')}</p>
          )}
        </TabsContent>
        <TabsContent value="issues">
          <IssuesTab
            canView={canView}
            loading={loading}
            error={error}
            setup={setup}
            issues={issues}
            onRefresh={() => setReloadKey((k) => k + 1)}
          />
        </TabsContent>
        <TabsContent value="support">
          <ComingSoon />
        </TabsContent>
      </Tabs>
    </div>
  )
}

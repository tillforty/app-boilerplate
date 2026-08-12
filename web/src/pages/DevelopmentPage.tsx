import { useEffect, useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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

/** The live issue list. */
function IssuesList({ issues, onRefresh }: { issues: Issue[]; onRefresh: () => void }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('development.tabIssues')}</CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('development.refresh')}
        </Button>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('development.issuesEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t('development.colIssue')}</th>
                  <th className="py-2 pr-4 font-medium">{t('development.colLevel')}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t('development.colEvents')}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t('development.colUsers')}</th>
                  <th className="py-2 pr-4 font-medium">{t('development.colLastSeen')}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {issues.map((it) => (
                  <tr key={it.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{it.title}</div>
                      {it.culprit && (
                        <div className="text-xs text-muted-foreground">{it.culprit}</div>
                      )}
                    </td>
                    <td className={`py-2 pr-4 font-medium ${levelClass(it.level)}`}>
                      {it.level ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{it.count}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{it.user_count}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                      {fmt(it.last_seen)}
                    </td>
                    <td className="py-2">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Issues tab: permission gate → setup checklist → live list. */
function IssuesTab() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canView = can('roles:manage')

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
  return <IssuesList issues={issues ?? []} onRefresh={() => setReloadKey((k) => k + 1)} />
}

export default function DevelopmentPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useTabParam<Tab>(TABS, 'issues')

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('development.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('development.subtitle')}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="agent">{t('development.tabAgent')}</TabsTrigger>
          <TabsTrigger value="issues">{t('development.tabIssues')}</TabsTrigger>
          <TabsTrigger value="support">{t('development.tabSupport')}</TabsTrigger>
        </TabsList>
        <TabsContent value="agent">
          <ComingSoon />
        </TabsContent>
        <TabsContent value="issues">
          <IssuesTab />
        </TabsContent>
        <TabsContent value="support">
          <ComingSoon />
        </TabsContent>
      </Tabs>
    </div>
  )
}

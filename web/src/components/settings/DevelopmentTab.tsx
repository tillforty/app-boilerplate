import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { useTranslation } from '@/i18n'
import {
  getDevConfig,
  updateDevConfig,
  validateDevConfig,
  type DevConfig,
} from '@/lib/development'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Order the checks are listed in; anything unknown is appended. */
const CHECK_ORDER = ['repo', 'token', 'pull', 'push', 'base_branch', 'pull_request', 'merge', 'runner', 'deploy']

function orderChecks<T extends { key: string }>(checks: T[]): T[] {
  return [...checks].sort((a, b) => {
    const ai = CHECK_ORDER.indexOf(a.key)
    const bi = CHECK_ORDER.indexOf(b.key)
    return (ai === -1 ? CHECK_ORDER.length : ai) - (bi === -1 ? CHECK_ORDER.length : bi)
  })
}

/**
 * Settings › App › Development — points the development agent at a GitHub repo
 * and proves, before the first job runs, that every step of the pipeline
 * (pull → push → PR → merge → deploy) will actually work.
 */
export default function DevelopmentTab() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<DevConfig | null>(null)
  const [repo, setRepo] = useState('')
  const [baseBranch, setBaseBranch] = useState('main')
  const [checkoutPath, setCheckoutPath] = useState('')
  const [deployEnabled, setDeployEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function apply(c: DevConfig) {
    setConfig(c)
    setRepo(c.repo_full_name ?? '')
    setBaseBranch(c.base_branch)
    setCheckoutPath(c.checkout_path)
    setDeployEnabled(c.deploy_enabled)
    setToken('')
  }

  useEffect(() => {
    let active = true
    getDevConfig()
      .then((c) => {
        if (active) apply(c)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : t('devSettings.loadFailed'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [t])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await updateDevConfig({
        repo_full_name: repo.trim() || null,
        base_branch: baseBranch.trim() || 'main',
        checkout_path: checkoutPath.trim(),
        deploy_enabled: deployEnabled,
        // Blank means "leave the stored token alone".
        ...(token.trim() ? { github_token: token.trim() } : {}),
      })
      apply(updated)
      setNotice(t('devSettings.saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('devSettings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function onValidate() {
    setValidating(true)
    setError(null)
    setNotice(null)
    try {
      apply(await validateDevConfig())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('devSettings.validateFailed'))
    } finally {
      setValidating(false)
    }
  }

  async function onClearToken() {
    setSaving(true)
    setError(null)
    try {
      apply(await updateDevConfig({ clear_token: true }))
      setNotice(t('devSettings.tokenCleared'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('devSettings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>

  const validation = config?.validation ?? null

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('devSettings.subtitle')}</p>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm">
          {notice}
        </div>
      )}

      <form onSubmit={onSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('devSettings.repoSection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dev-repo">{t('devSettings.repo')}</Label>
              <Input
                id="dev-repo"
                value={repo}
                placeholder="owner/repository"
                onChange={(e) => setRepo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('devSettings.repoHint')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dev-branch">{t('devSettings.baseBranch')}</Label>
                <Input
                  id="dev-branch"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('devSettings.baseBranchHint')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-token">{t('devSettings.token')}</Label>
                <Input
                  id="dev-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  placeholder={
                    config?.has_token ? t('devSettings.tokenStored') : t('devSettings.tokenPlaceholder')
                  }
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('devSettings.tokenHint')}</p>
                {config?.has_token && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-0 text-xs text-muted-foreground hover:text-destructive"
                    onClick={onClearToken}
                  >
                    {t('devSettings.clearToken')}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('devSettings.deploySection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={deployEnabled}
                onCheckedChange={(c) => setDeployEnabled(c === true)}
              />
              <span>
                {t('devSettings.deployEnabled')}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t('devSettings.deployEnabledHint')}
                </span>
              </span>
            </label>
            <div className="space-y-2">
              <Label htmlFor="dev-checkout">{t('devSettings.checkoutPath')}</Label>
              <Input
                id="dev-checkout"
                value={checkoutPath}
                onChange={(e) => setCheckoutPath(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('devSettings.checkoutPathHint')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  config?.runner_online ? 'bg-green-500' : 'bg-muted-foreground/40'
                }`}
              />
              <span>
                {config?.runner_online ? t('devSettings.runnerOnline') : t('devSettings.runnerOffline')}
              </span>
              {!config?.runner_online && (
                <span className="text-xs text-muted-foreground">
                  · {t('devSettings.runnerOfflineHint')}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? t('common.saving') : t('settings.save')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={validating || !config?.repo_full_name}
            onClick={onValidate}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            {validating ? t('devSettings.validating') : t('devSettings.validate')}
          </Button>
          {!config?.repo_full_name && (
            <span className="text-xs text-muted-foreground">{t('devSettings.saveFirst')}</span>
          )}
        </div>
      </form>

      {validation && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {t('devSettings.checksTitle')}
              <Badge variant={validation.ok ? 'default' : 'destructive'}>
                {validation.ok ? t('devSettings.checksPass') : t('devSettings.checksFail')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2">
              {orderChecks(validation.checks).map((c) => (
                <li key={c.key} className="flex gap-3">
                  {c.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{t(`devSettings.check_${c.key}`)}</p>
                    <p className="text-sm text-muted-foreground">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            {config?.validated_at && (
              <p className="text-xs text-muted-foreground">
                {t('devSettings.lastChecked', {
                  when: new Date(config.validated_at).toLocaleString(),
                })}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

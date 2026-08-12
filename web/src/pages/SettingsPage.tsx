import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  getAdminSettings,
  updateSettings,
  uploadLogo,
  getObservabilityStatus,
  CURRENCY_PRESETS,
  COMMON_TIMEZONES,
  type AdminSettings,
  type ObservabilityStatus,
} from '@/lib/settings'
import { useAppSettings } from '@/context/AppSettingsContext'
import { usePermissions } from '@/context/PermissionsContext'
import { LANGUAGE_LABELS, useTranslation, type Language } from '@/i18n'
import { useTabParam } from '@/lib/use-tab-param'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import LlmCredentialsTab from '@/components/settings/LlmCredentialsTab'
import AiFunctionsTab from '@/components/settings/AiFunctionsTab'
import DevelopmentTab from '@/components/settings/DevelopmentTab'

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const SETTINGS_TABS = ['general', 'llm', 'functions', 'development'] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]

export default function SettingsPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const { refresh } = useAppSettings()
  const canManage = can('roles:manage')
  const canAi = can('ai:manage')
  const canDev = can('development:manage')
  const [tab, setTab] = useTabParam<SettingsTab>(SETTINGS_TABS, 'general')

  const [form, setForm] = useState<AdminSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  // Preview the picked logo without leaking object URLs: create one per file
  // and revoke it when the file changes or the component unmounts.
  const logoPreview = useMemo(
    () => (logoFile ? URL.createObjectURL(logoFile) : null),
    [logoFile],
  )
  useEffect(() => {
    if (!logoPreview) return
    return () => URL.revokeObjectURL(logoPreview)
  }, [logoPreview])
  const [logoError, setLogoError] = useState<string | null>(null)
  const [logoVersion, setLogoVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [obs, setObs] = useState<ObservabilityStatus | null>(null)

  useEffect(() => {
    if (!canManage) return
    let active = true
    getObservabilityStatus()
      .then((s) => {
        if (active) setObs(s)
      })
      .catch(() => {
        // Non-critical: the error-monitoring card just stays hidden.
      })
    return () => {
      active = false
    }
  }, [canManage])

  useEffect(() => {
    if (!canManage) {
      setLoading(false)
      return
    }
    let active = true
    getAdminSettings()
      .then((s) => {
        if (active) {
          setForm(s)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : t('settings.loadFailed'))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [canManage, t])

  function set<K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }

  function onCurrency(code: string) {
    const match = CURRENCY_PRESETS.find((c) => c.code === code)
    setForm((f) =>
      f ? { ...f, currency_code: code, currency_symbol: match ? match.symbol : f.currency_symbol } : f,
    )
  }

  function onLogo(file: File | null) {
    setLogoError(null)
    if (file) {
      if (!file.type.startsWith('image/')) return setLogoError(t('onboarding.logoNotImage'))
      if (file.size > LOGO_MAX_BYTES) return setLogoError(t('onboarding.logoTooLarge'))
    }
    setLogoFile(file)
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      if (logoFile) await uploadLogo(logoFile)
      await updateSettings({
        app_name: form.app_name.trim(),
        default_language: form.default_language,
        currency_code: form.currency_code.trim(),
        currency_symbol: form.currency_symbol.trim(),
        timezone: form.timezone,
        demo_mode: form.demo_mode,
        from_name: form.from_name.trim(),
        from_email: form.from_email.trim(),
        support_email: form.support_email.trim(),
      })
      setLogoFile(null)
      setLogoVersion((v) => v + 1)
      refresh() // update header/title/logo live
      const fresh = await getAdminSettings()
      setForm(fresh)
      setNotice(t('settings.saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-content">
        <p className="text-sm text-muted-foreground">{t('settings.noPermission')}</p>
      </div>
    )
  }
  const logoSrc = form?.logo_url ? `${form.logo_url}?v=${logoVersion}` : null

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)}>
        <TabsList>
          <TabsTrigger value="general">{t('settings.tabGeneral')}</TabsTrigger>
          <TabsTrigger value="llm">{t('settings.tabLlm')}</TabsTrigger>
          <TabsTrigger value="functions">{t('settings.tabFunctions')}</TabsTrigger>
          <TabsTrigger value="development">{t('settings.tabDevelopment')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          {loading || !form ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <>
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
            <CardTitle className="text-base">{t('onboarding.sectionApp')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="s-app-name">{t('onboarding.appName')}</Label>
              <Input
                id="s-app-name"
                value={form.app_name}
                onChange={(e) => set('app_name', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-logo">{t('onboarding.logo')}</Label>
              <div className="flex items-center gap-4">
                {(logoPreview || logoSrc) && (
                  <img
                    src={logoPreview ?? logoSrc!}
                    alt="logo"
                    className="h-10 w-auto"
                  />
                )}
                <Input
                  id="s-logo"
                  type="file"
                  accept="image/*"
                  onChange={(e) => onLogo(e.target.files?.[0] ?? null)}
                />
              </div>
              {logoError && <p className="text-sm text-destructive">{logoError}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t('onboarding.language')}</Label>
                <Select
                  value={form.default_language}
                  onValueChange={(v) => set('default_language', v as Language)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LANGUAGE_LABELS) as Language[]).map((l) => (
                      <SelectItem key={l} value={l}>
                        {LANGUAGE_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.currency')}</Label>
                <Select value={form.currency_code} onValueChange={onCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_PRESETS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} ({c.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-cur-symbol">{t('onboarding.currencySymbol')}</Label>
                <Input
                  id="s-cur-symbol"
                  value={form.currency_symbol}
                  onChange={(e) => set('currency_symbol', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('onboarding.timezone')}</Label>
              <Select value={form.timezone} onValueChange={(v) => set('timezone', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([form.timezone, ...COMMON_TIMEZONES])].map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('onboarding.sectionEmail')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="s-from-name">{t('onboarding.fromName')}</Label>
                <Input
                  id="s-from-name"
                  value={form.from_name}
                  onChange={(e) => set('from_name', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-from-email">{t('onboarding.fromEmail')}</Label>
                <Input
                  id="s-from-email"
                  type="email"
                  value={form.from_email}
                  onChange={(e) => set('from_email', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-support-email">{t('onboarding.supportEmail')}</Label>
              <Input
                id="s-support-email"
                type="email"
                value={form.support_email}
                onChange={(e) => set('support_email', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('onboarding.sectionDemo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.demo_mode}
                onCheckedChange={(c) => set('demo_mode', c === true)}
              />
              {t('onboarding.demoMode')}
            </label>
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving || !form.app_name.trim() || !!logoError}>
          {saving ? t('common.saving') : t('settings.save')}
        </Button>
      </form>

      {obs && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('observability.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('observability.subtitle')}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  obs.capture_configured ? 'bg-green-500' : 'bg-muted-foreground/40'
                }`}
              />
              <span>
                {obs.capture_configured ? t('observability.active') : t('observability.inactive')}
              </span>
              {obs.capture_configured && (
                <span className="text-muted-foreground">
                  · {t('observability.environment')}: {obs.environment}
                </span>
              )}
            </div>
            {!obs.capture_configured && (
              <p className="text-sm text-muted-foreground">{t('observability.inactiveHint')}</p>
            )}
            {obs.ui_url ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(obs.ui_url!, '_blank', 'noopener,noreferrer')}
              >
                {t('observability.open')}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{t('observability.noUi')}</p>
            )}
          </CardContent>
        </Card>
      )}
            </>
          )}
        </TabsContent>

        <TabsContent value="llm">
          {canAi ? (
            <LlmCredentialsTab />
          ) : (
            <p className="text-sm text-muted-foreground">{t('settings.noPermission')}</p>
          )}
        </TabsContent>

        <TabsContent value="functions">
          {canAi ? (
            <AiFunctionsTab />
          ) : (
            <p className="text-sm text-muted-foreground">{t('settings.noPermission')}</p>
          )}
        </TabsContent>

        <TabsContent value="development">
          {canDev ? (
            <DevelopmentTab />
          ) : (
            <p className="text-sm text-muted-foreground">{t('settings.noPermission')}</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

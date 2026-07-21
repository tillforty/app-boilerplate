import { useMemo, useState, type FormEvent } from 'react'
import { submitOnboarding } from '@/lib/settings'
import { ApiError } from '@/lib/api'
import { LANGUAGE_LABELS, useTranslation, type Language } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const CURRENCIES: { code: string; symbol: string }[] = [
  { code: 'EUR', symbol: '€' },
  { code: 'USD', symbol: '$' },
  { code: 'GBP', symbol: '£' },
  { code: 'PLN', symbol: 'zł' },
  { code: 'SEK', symbol: 'kr' },
]

const TIMEZONES = [
  'Europe/Vilnius',
  'Europe/Riga',
  'Europe/Tallinn',
  'Europe/Warsaw',
  'Europe/Helsinki',
  'Europe/London',
  'Europe/Berlin',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
]

const LOGO_MAX_BYTES = 2 * 1024 * 1024

export default function OnboardingPage() {
  const { t } = useTranslation()

  const [appName, setAppName] = useState('')
  const [language, setLanguage] = useState<Language>('en')
  const [currencyCode, setCurrencyCode] = useState('EUR')
  const [currencySymbol, setCurrencySymbol] = useState('€')
  const [timezone, setTimezone] = useState('Europe/Vilnius')
  const [demoMode, setDemoMode] = useState(false)
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminSurname, setAdminSurname] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [logo, setLogo] = useState<File | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const logoPreview = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo])

  const valid =
    appName.trim() &&
    adminName.trim() &&
    adminEmail.trim() &&
    adminPassword.length >= 8 &&
    !logoError

  function onCurrency(code: string) {
    setCurrencyCode(code)
    const match = CURRENCIES.find((c) => c.code === code)
    if (match) setCurrencySymbol(match.symbol)
  }

  function onLogo(file: File | null) {
    setLogoError(null)
    if (file) {
      if (!file.type.startsWith('image/')) {
        setLogoError(t('onboarding.logoNotImage'))
        return
      }
      if (file.size > LOGO_MAX_BYTES) {
        setLogoError(t('onboarding.logoTooLarge'))
        return
      }
    }
    setLogo(file)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await submitOnboarding({
        app_name: appName.trim(),
        default_language: language,
        currency_code: currencyCode.trim(),
        currency_symbol: currencySymbol.trim(),
        timezone,
        demo_mode: demoMode,
        from_name: fromName.trim(),
        from_email: fromEmail.trim(),
        support_email: supportEmail.trim(),
        admin_name: adminName.trim(),
        admin_surname: adminSurname.trim(),
        admin_email: adminEmail.trim(),
        admin_password: adminPassword,
        logo,
      })
      // Hard reload so the settings context re-fetches (onboarded=true, new
      // branding) before the gate re-evaluates — avoids a stale bounce back here.
      window.location.assign('/login')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone else onboarded this instance first — just proceed to login.
        window.location.assign('/login')
        return
      }
      setError(err instanceof Error ? err.message : t('onboarding.failed'))
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-dvh overflow-y-auto bg-muted/30 px-4 py-10">
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">{t('onboarding.title')}</CardTitle>
          <CardDescription>{t('onboarding.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-8">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Identity */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('onboarding.sectionApp')}
              </h3>
              <div className="space-y-2">
                <Label htmlFor="app-name">{t('onboarding.appName')}</Label>
                <Input id="app-name" value={appName} onChange={(e) => setAppName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="logo">{t('onboarding.logo')}</Label>
                <div className="flex items-center gap-4">
                  {logoPreview && (
                    <img src={logoPreview} alt="logo preview" className="h-10 w-auto" />
                  )}
                  <Input
                    id="logo"
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
                  <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
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
                  <Select value={currencyCode} onValueChange={onCurrency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} ({c.symbol})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cur-symbol">{t('onboarding.currencySymbol')}</Label>
                  <Input
                    id="cur-symbol"
                    value={currencySymbol}
                    onChange={(e) => setCurrencySymbol(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('onboarding.timezone')}</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            {/* Admin account */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('onboarding.sectionAdmin')}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="admin-name">{t('onboarding.adminName')}</Label>
                  <Input
                    id="admin-name"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-surname">{t('onboarding.adminSurname')}</Label>
                  <Input
                    id="admin-surname"
                    value={adminSurname}
                    onChange={(e) => setAdminSurname(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-email">{t('onboarding.adminEmail')}</Label>
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="off"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-password">{t('onboarding.adminPassword')}</Label>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="new-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('onboarding.passwordHint')}</p>
              </div>
            </section>

            {/* Email + demo */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('onboarding.sectionEmail')}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="from-name">{t('onboarding.fromName')}</Label>
                  <Input
                    id="from-name"
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="from-email">{t('onboarding.fromEmail')}</Label>
                  <Input
                    id="from-email"
                    type="email"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-email">{t('onboarding.supportEmail')}</Label>
                <Input
                  id="support-email"
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={demoMode}
                  onCheckedChange={(c) => setDemoMode(c === true)}
                />
                {t('onboarding.demoMode')}
              </label>
            </section>

            <Button type="submit" className="w-full" disabled={submitting || !valid}>
              {submitting ? t('onboarding.submitting') : t('onboarding.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

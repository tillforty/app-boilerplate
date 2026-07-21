import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  getAuthProviders,
  getDemoInfo,
  oauthLoginUrl,
  type AuthProvider,
  type DemoInfo,
} from '@/lib/auth'
import { useTranslation } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { appConfig } from '@/config/app-config'
import { useAppSettings } from '@/context/AppSettingsContext'

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  )
}

const PROVIDER_ICONS: Record<string, () => JSX.Element> = {
  google: GoogleIcon,
  microsoft: MicrosoftIcon,
}

export default function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const { settings } = useAppSettings()
  const navigate = useNavigate()
  const appName = settings?.app_name ?? appConfig.brand.name
  const logoSrc = settings?.logo_url ?? appConfig.brand.logoSrc

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [providers, setProviders] = useState<AuthProvider[]>([])
  const [demo, setDemo] = useState<DemoInfo | null>(null)

  // Only providers the backend has configured come back here, so the buttons
  // appear exactly when their env vars are set.
  useEffect(() => {
    getAuthProviders()
      .then(setProviders)
      .catch(() => setProviders([]))
  }, [])

  // Demo mode (DEMO_MODE on the backend): surface the public demo credentials.
  useEffect(() => {
    getDemoInfo()
      .then(setDemo)
      .catch(() => setDemo(null))
  }, [])

  function fillDemo() {
    if (!demo?.username) return
    setEmail(demo.username)
    setPassword(demo.password ?? '')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch {
      setError(t('auth.invalidCredentials'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <img src={logoSrc} alt={appName} className="mx-auto h-8" />
          <CardTitle>{t('auth.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {demo?.enabled && demo.username && (
            <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
              <p className="font-medium">{t('auth.demoTitle')}</p>
              <p className="mt-1 text-muted-foreground">
                {t('auth.demoUsername')}: <code className="font-mono">{demo.username}</code>
                {' · '}
                {t('auth.demoPassword')}: <code className="font-mono">{demo.password}</code>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={fillDemo}
              >
                {t('auth.demoUse')}
              </Button>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>

          {providers.length > 0 && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    {t('auth.continueWith')}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {providers.map((p) => {
                  const Icon = PROVIDER_ICONS[p.id]
                  return (
                    <Button
                      key={p.id}
                      asChild
                      variant="outline"
                      className="w-full"
                    >
                      <a href={oauthLoginUrl(p.id)}>
                        {Icon && <Icon />}
                        <span className="ml-2">{t('auth.signInWith', { provider: p.name })}</span>
                      </a>
                    </Button>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

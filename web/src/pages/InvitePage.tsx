import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/lib/api'
import { acceptInvite, getInvite, type InviteInfo } from '@/lib/auth'
import { useTranslation } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { appConfig } from '@/config/app-config'

/** Public page an invited user lands on: set a password, activate, sign in. */
export default function InvitePage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const { setUser } = useAuth()
  const navigate = useNavigate()

  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getInvite(token)
      .then(setInfo)
      .catch((err) => {
        setLoadError(
          err instanceof ApiError && err.status === 410 ? t('invite.expired') : t('invite.invalid'),
        )
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError(t('invite.passwordTooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('invite.passwordMismatch'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      setUser(await acceptInvite(token, password))
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) setError(t('invite.expired'))
      else if (err instanceof ApiError && err.status === 404) setError(t('invite.invalid'))
      else setError(t('invite.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <img src={appConfig.brand.logoSrc} alt={appConfig.brand.name} className="mx-auto h-8" />
          <CardTitle>{t('invite.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : (
            info && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('invite.greeting', { name: info.name, email: info.email })}
                </p>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-password">{t('invite.password')}</Label>
                    <Input
                      id="invite-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-confirm">{t('invite.confirmPassword')}</Label>
                    <Input
                      id="invite-confirm"
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? t('invite.accepting') : t('invite.accept')}
                  </Button>
                </form>
              </>
            )
          )}
        </CardContent>
      </Card>
    </div>
  )
}

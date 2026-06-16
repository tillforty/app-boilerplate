import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { completeOAuthLogin } from '@/lib/auth'
import { useAuth } from '@/context/AuthContext'
import { useTranslation } from '@/i18n'

/**
 * Landing route for the OAuth redirect (default path: /auth/callback — keep it
 * OUTSIDE <ProtectedRoute>). Reads the JWT from the URL fragment, stores it,
 * loads the user, then navigates home.
 */
export default function OAuthCallback() {
  const { t } = useTranslation()
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (!token) {
      setError(t('auth.missingToken'))
      return
    }
    completeOAuthLogin(token)
      .then((user) => {
        setUser(user)
        navigate('/', { replace: true })
      })
      .catch(() => setError(t('auth.callbackFailed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          {t('auth.completing')}
        </div>
      )}
    </div>
  )
}

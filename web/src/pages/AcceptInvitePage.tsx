import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getInvite, acceptInvite, type InviteInfo } from '@/lib/auth'
import { appConfig } from '@/config/app-config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingInvite, setLoadingInvite] = useState(true)

  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError('Invalid invite link.')
      setLoadingInvite(false)
      return
    }
    getInvite(token)
      .then((info) => { setInvite(info); setLoadingInvite(false) })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : 'This invite is invalid or has expired.')
        setLoadingInvite(false)
      })
  }, [token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    if (password !== confirm) {
      setFormError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      await acceptInvite(token, { name: name.trim(), surname: surname.trim(), password })
      setDone(true)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <img src={appConfig.brand.logoSrc} alt={appConfig.brand.name} className="mx-auto h-8" />
          <CardTitle>Create your account</CardTitle>
          {invite && !done && (
            <CardDescription>
              You've been invited{invite.role_name ? ` as ${invite.role_name}` : ''}.
              Set your name and a password to get started.
            </CardDescription>
          )}
        </CardHeader>

        <CardContent>
          {loadingInvite ? (
            <p className="text-center text-sm text-muted-foreground">Verifying invite…</p>
          ) : loadError ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="outline" className="w-full" onClick={() => navigate('/login')}>
                Back to login
              </Button>
            </div>
          ) : done ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Your account has been created. You can now sign in.
              </p>
              <Button className="w-full" onClick={() => navigate('/login')}>
                Go to login
              </Button>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="text-center text-sm text-muted-foreground">
                Joining as <span className="font-medium text-foreground">{invite!.email}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">First name</Label>
                  <Input
                    id="name"
                    autoComplete="given-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="surname">Last name</Label>
                  <Input
                    id="surname"
                    autoComplete="family-name"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}

              <Button type="submit" className="w-full" disabled={submitting || !name.trim() || !surname.trim()}>
                {submitting ? 'Creating account…' : 'Create account'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

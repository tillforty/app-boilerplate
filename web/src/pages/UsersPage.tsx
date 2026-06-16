import { useEffect, useState } from 'react'
import { listUsers, type User } from '@/lib/auth'
import { listRoles, assignRole, type Role } from '@/lib/roles'
import { usePermissions } from '@/context/PermissionsContext'
import { useTranslation } from '@/i18n'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function UsersPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canManage = can('users:update')

  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [u, r] = await Promise.all([listUsers(), canManage ? listRoles() : Promise.resolve([])])
      setUsers(u)
      setRoles(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onAssign(userId: number, roleId: string) {
    if (!roleId) return
    setError(null)
    try {
      await assignRole(userId, Number(roleId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign role')
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('nav.users')}</h1>
        <p className="text-sm text-muted-foreground">People with access to this app.</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {users.map((u) => (
            <Card key={u.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {u.name} {u.surname}
                </CardTitle>
                <CardDescription>{u.email}</CardDescription>
              </CardHeader>
              {canManage && (
                <CardContent>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{t('nav.roles')}:</span>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      defaultValue=""
                      onChange={(e) => onAssign(u.id, e.target.value)}
                    >
                      <option value="" disabled>
                        —
                      </option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

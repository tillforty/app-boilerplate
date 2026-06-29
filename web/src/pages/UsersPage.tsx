import { useEffect, useState } from 'react'
import { listUsers, type UserRow } from '@/lib/auth'
import { listRoles, assignRole, type Role } from '@/lib/roles'
import { usePermissions } from '@/context/PermissionsContext'
import { useTranslation } from '@/i18n'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function initials(name: string, surname: string): string {
  return `${name.charAt(0)}${surname.charAt(0)}`.toUpperCase() || '?'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function UsersPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canManage = can('users:update')

  const [users, setUsers] = useState<UserRow[]>([])
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
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? { ...u, role: roles.find((r) => r.id === Number(roleId))?.name ?? u.role }
            : u,
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign role')
    }
  }

  const colSpan = canManage ? 5 : 4

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

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('users.colUser')}</TableHead>
              <TableHead>{t('users.colEmail')}</TableHead>
              <TableHead>{t('users.colRole')}</TableHead>
              <TableHead>{t('users.colJoined')}</TableHead>
              {canManage && <TableHead className="text-right">{t('users.colActions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  {canManage && <TableCell><Skeleton className="ml-auto h-9 w-32" /></TableCell>}
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  {t('users.empty')}
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">
                          {initials(u.name, u.surname)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">
                        {u.name} {u.surname}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    {u.role ? (
                      <Badge variant="secondary" className="capitalize">
                        {u.role}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Select
                        value={roles.find((r) => r.name === u.role)?.id?.toString() ?? ''}
                        onValueChange={(v) => onAssign(u.id, v)}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue placeholder={t('users.assignRole')} />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id.toString()}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

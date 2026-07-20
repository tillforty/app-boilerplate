import { useEffect, useState } from 'react'
import { Check, Copy, MoreHorizontal, Plus } from 'lucide-react'
import {
  activateUser,
  createUser,
  deactivateUser,
  inviteUrl,
  inviteUser,
  listUsers,
  resendInvite,
  type UserRow,
  type UserStatus,
} from '@/lib/auth'
import { listRoles, assignRole, type Role } from '@/lib/roles'
import { usePermissions } from '@/context/PermissionsContext'
import { useTranslation } from '@/i18n'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  const canCreate = can('users:create')
  const canArchive = can('users:delete')

  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<UserStatus>('active')

  const emptyForm = { name: '', surname: '', email: '', password: '', roleId: '' }
  const [createOpen, setCreateOpen] = useState(false)
  const [inviteMode, setInviteMode] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // After a successful invite: show the link so it can be copied even without SMTP.
  const [inviteResult, setInviteResult] = useState<{ email: string; url: string; sent: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [u, r] = await Promise.all([
        listUsers(),
        canManage || canCreate ? listRoles() : Promise.resolve([]),
      ])
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

  function openCreate() {
    setForm(emptyForm)
    setCreateError(null)
    setInviteResult(null)
    setCopied(false)
    setCreateOpen(true)
  }

  async function onCreate() {
    setCreating(true)
    setCreateError(null)
    try {
      const base = {
        name: form.name,
        surname: form.surname,
        email: form.email,
        ...(form.roleId ? { role_id: Number(form.roleId) } : {}),
      }
      if (inviteMode) {
        const res = await inviteUser(base)
        setUsers((prev) => [...prev, res])
        setInviteResult({ email: res.email, url: res.invite_url, sent: res.email_sent })
        setTab('pending')
      } else {
        const created = await createUser({ ...base, password: form.password })
        setUsers((prev) => [...prev, created])
        setCreateOpen(false)
        setTab('active')
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t('users.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be unavailable (http, permissions) — surface the URL instead.
      window.prompt(t('users.copyInviteUrl'), url)
    }
  }

  async function onResend(u: UserRow) {
    setError(null)
    setNotice(null)
    try {
      const res = await resendInvite(u.id)
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...res } : x)))
      setNotice(
        res.email_sent
          ? t('users.inviteEmailSent', { email: res.email })
          : t('users.inviteResent', { email: res.email }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : t('users.actionFailed'))
    }
  }

  async function onCopyRowUrl(u: UserRow) {
    if (!u.invite_token) return
    setNotice(null)
    try {
      await navigator.clipboard.writeText(inviteUrl(u.invite_token))
      setNotice(t('users.copied'))
    } catch {
      window.prompt(t('users.copyInviteUrl'), inviteUrl(u.invite_token))
    }
  }

  async function onDeactivate(u: UserRow) {
    if (!window.confirm(t('users.deactivateConfirm', { name: `${u.name} ${u.surname}` }))) return
    setError(null)
    setNotice(null)
    try {
      await deactivateUser(u.id)
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: 'inactive' } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('users.actionFailed'))
    }
  }

  async function onActivate(u: UserRow) {
    setError(null)
    setNotice(null)
    try {
      await activateUser(u.id)
      // Users who never set a password go back to pending, not active.
      const next: UserStatus = u.invite_token != null ? 'pending' : 'active'
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: next } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('users.actionFailed'))
    }
  }

  const visible = users.filter((u) => u.status === tab)
  const counts = {
    active: users.filter((u) => u.status === 'active').length,
    pending: users.filter((u) => u.status === 'pending').length,
    inactive: users.filter((u) => u.status === 'inactive').length,
  }

  const showKebab = canArchive || canCreate
  const colSpan = 4 + (canManage ? 1 : 0) + (showKebab ? 1 : 0)
  const emptyText =
    tab === 'pending' ? t('users.emptyPending') : tab === 'inactive' ? t('users.emptyInactive') : t('users.empty')

  const formValid =
    form.name.trim() &&
    form.surname.trim() &&
    form.email.trim() &&
    (inviteMode || form.password.length >= 8)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('nav.users')}</h1>
          <p className="text-sm text-muted-foreground">People with access to this app.</p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('users.newUser')}
          </Button>
        )}
      </div>

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

      <Tabs value={tab} onValueChange={(v) => setTab(v as UserStatus)}>
        <TabsList>
          <TabsTrigger value="active">
            {t('users.tabActive')} ({counts.active})
          </TabsTrigger>
          <TabsTrigger value="pending">
            {t('users.tabPending')} ({counts.pending})
          </TabsTrigger>
          <TabsTrigger value="inactive">
            {t('users.tabInactive')} ({counts.inactive})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('users.colUser')}</TableHead>
              <TableHead>{t('users.colEmail')}</TableHead>
              <TableHead>{t('users.colRole')}</TableHead>
              <TableHead>{t('users.colJoined')}</TableHead>
              {canManage && <TableHead className="text-right">{t('users.colActions')}</TableHead>}
              {showKebab && <TableHead className="w-10" />}
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
                  {showKebab && <TableCell><Skeleton className="h-8 w-8" /></TableCell>}
                </TableRow>
              ))
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((u) => (
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
                  {showKebab && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {u.status === 'pending' && canCreate && (
                            <>
                              <DropdownMenuItem onClick={() => void onResend(u)}>
                                {t('users.resendInvite')}
                              </DropdownMenuItem>
                              {u.invite_token && (
                                <DropdownMenuItem onClick={() => void onCopyRowUrl(u)}>
                                  {t('users.copyInviteUrl')}
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                          {u.status !== 'inactive' && canArchive && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => void onDeactivate(u)}
                            >
                              {t('users.deactivate')}
                            </DropdownMenuItem>
                          )}
                          {u.status === 'inactive' && canArchive && (
                            <DropdownMenuItem onClick={() => void onActivate(u)}>
                              {t('users.activate')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          {inviteResult ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('users.inviteCreatedTitle')}</DialogTitle>
                <DialogDescription>
                  {inviteResult.sent
                    ? t('users.inviteEmailSent', { email: inviteResult.email })
                    : t('users.inviteEmailNotSent', { email: inviteResult.email })}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <Input readOnly value={inviteResult.url} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => void copyUrl(inviteResult.url)}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setCreateOpen(false)}>{t('users.done')}</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('users.createTitle')}</DialogTitle>
                <DialogDescription>
                  {inviteMode ? t('users.inviteHint') : t('users.createHint')}
                </DialogDescription>
              </DialogHeader>

              <Tabs
                value={inviteMode ? 'invite' : 'password'}
                onValueChange={(v) => setInviteMode(v === 'invite')}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="invite">{t('users.modeInvite')}</TabsTrigger>
                  <TabsTrigger value="password">{t('users.modePassword')}</TabsTrigger>
                </TabsList>
              </Tabs>

              {createError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                  {createError}
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-user-name">{t('users.firstName')}</Label>
                    <Input
                      id="new-user-name"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-user-surname">{t('users.lastName')}</Label>
                    <Input
                      id="new-user-surname"
                      value={form.surname}
                      onChange={(e) => setForm((f) => ({ ...f, surname: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-email">{t('users.email')}</Label>
                  <Input
                    id="new-user-email"
                    type="email"
                    autoComplete="off"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                {!inviteMode && (
                  <div className="space-y-2">
                    <Label htmlFor="new-user-password">{t('users.password')}</Label>
                    <Input
                      id="new-user-password"
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{t('users.role')}</Label>
                  <Select
                    value={form.roleId}
                    onValueChange={(v) => setForm((f) => ({ ...f, roleId: v }))}
                  >
                    <SelectTrigger>
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
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={() => void onCreate()} disabled={creating || !formValid}>
                  {creating
                    ? inviteMode
                      ? t('users.inviting')
                      : t('common.saving')
                    : inviteMode
                      ? t('users.invite')
                      : t('common.create')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

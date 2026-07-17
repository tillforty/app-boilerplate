import { useEffect, useState } from 'react'
import { Copy, Check, UserPlus, Mail } from 'lucide-react'
import { listUsers, sendInvite, listInvites, type UserRow, type InviteOut } from '@/lib/auth'
import { listRoles, assignRole, type Role } from '@/lib/roles'
import { usePermissions } from '@/context/PermissionsContext'
import { useTranslation } from '@/i18n'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function initials(name: string, surname: string): string {
  return `${name.charAt(0)}${surname.charAt(0)}`.toUpperCase() || '?'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={copy}>
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

export default function UsersPage() {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const canManage = can('users:update')
  const canInvite = can('users:create')

  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [pendingInvites, setPendingInvites] = useState<InviteOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRoleId, setInviteRoleId] = useState<string>('')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<InviteOut | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [u, r, inv] = await Promise.all([
        listUsers(),
        canManage || canInvite ? listRoles() : Promise.resolve([]),
        canInvite ? listInvites() : Promise.resolve([]),
      ])
      setUsers(u)
      setRoles(r)
      setPendingInvites(inv)
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

  function openInvite() {
    setInviteEmail('')
    setInviteRoleId('')
    setInviteResult(null)
    setInviteError(null)
    setInviteOpen(true)
  }

  async function submitInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteError(null)
    try {
      const result = await sendInvite(inviteEmail.trim(), inviteRoleId ? Number(inviteRoleId) : undefined)
      setInviteResult(result)
      setPendingInvites((prev) => [result, ...prev])
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  function closeInviteDialog() {
    setInviteOpen(false)
    setInviteResult(null)
  }

  const colSpan = canManage ? 5 : 4

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('nav.users')}</h1>
          <p className="text-sm text-muted-foreground">People with access to this app.</p>
        </div>
        {canInvite && (
          <Button onClick={openInvite} className="w-full sm:w-auto">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite user
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
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

      {/* Pending invites */}
      {canInvite && pendingInvites.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Pending invites</h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Invite link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      {inv.role_name ? (
                        <Badge variant="secondary" className="capitalize">{inv.role_name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(inv.expires_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
                          {inv.invite_url}
                        </span>
                        <CopyButton text={inv.invite_url} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => { if (!o) closeInviteDialog() }}>
        <DialogContent className="sm:max-w-md">
          {inviteResult ? (
            <>
              <DialogHeader>
                <DialogTitle>Invite sent</DialogTitle>
                <DialogDescription>
                  {inviteResult.email_sent
                    ? `An invite email was sent to ${inviteResult.email}.`
                    : `Email is not configured — share this link directly with ${inviteResult.email}.`}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-2">
                {inviteResult.email_sent && (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <Mail className="h-4 w-4 shrink-0" />
                    Invite email delivered
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Invite link (valid 72 hours)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={inviteResult.invite_url}
                      className="font-mono text-xs"
                      onFocus={(e) => e.target.select()}
                    />
                    <CopyButton text={inviteResult.invite_url} />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button onClick={closeInviteDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Invite a user</DialogTitle>
                <DialogDescription>
                  They'll receive an invite link to set their password and join.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Email address</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void submitInvite() }}
                    disabled={inviting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-role">Role (optional)</Label>
                  <Select value={inviteRoleId} onValueChange={setInviteRoleId} disabled={inviting}>
                    <SelectTrigger id="invite-role">
                      <SelectValue placeholder="Select a role…" />
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
                {inviteError && (
                  <p className="text-sm text-destructive">{inviteError}</p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeInviteDialog} disabled={inviting}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitInvite()}
                  disabled={inviting || !inviteEmail.trim()}
                >
                  {inviting ? 'Sending…' : 'Send invite'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Lock, ShieldCheck } from 'lucide-react'
import {
  listRoles,
  getPermissionCatalog,
  createRole,
  updateRole,
  deleteRole,
  permKey,
  WILDCARD,
  type Role,
  type PermissionCatalog,
} from '@/lib/roles'
import { usePermissions } from '@/context/PermissionsContext'
import { useTranslation } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface EditState {
  role: Role | null // null = creating a new role
  name: string
  description: string
  permissions: string[]
}

const ADMIN = 'administrator'

export default function RolesPage() {
  const { t } = useTranslation()
  const { can, refresh: refreshMine } = usePermissions()
  const canManage = can('roles:manage')

  const [roles, setRoles] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [r, c] = await Promise.all([listRoles(), getPermissionCatalog()])
      setRoles(r)
      setCatalog(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roles.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function startCreate() {
    setEdit({ role: null, name: '', description: '', permissions: [] })
  }

  function startEdit(role: Role) {
    setEdit({
      role,
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
    })
  }

  function togglePermission(key: string, checked: boolean) {
    setEdit((s) =>
      s
        ? {
            ...s,
            permissions: checked
              ? [...s.permissions, key]
              : s.permissions.filter((p) => p !== key),
          }
        : s,
    )
  }

  async function save() {
    if (!edit) return
    setSaving(true)
    setError(null)
    try {
      const body = {
        name: edit.name.trim(),
        description: edit.description.trim(),
        permissions: edit.permissions,
      }
      if (edit.role) {
        await updateRole(edit.role.id, body)
      } else {
        await createRole(body)
      }
      setEdit(null)
      await load()
      await refreshMine() // your own permissions may have changed
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roles.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(role: Role) {
    if (!window.confirm(t('roles.deleteConfirm', { name: role.name }))) return
    setError(null)
    try {
      await deleteRole(role.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roles.deleteFailed'))
    }
  }

  const isAdminRole = edit?.role?.name === ADMIN
  const permsLocked = isAdminRole // administrator is always full-access
  const nameLocked = !!edit?.role?.is_system // system roles can't be renamed

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('roles.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('roles.subtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('roles.newRole')}
          </Button>
        )}
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
          {roles.map((role) => (
            <Card key={role.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      {role.name === ADMIN && <ShieldCheck className="h-4 w-4 text-primary" />}
                      {role.name}
                      {role.is_system && (
                        <Badge variant="secondary" className="gap-1">
                          <Lock className="h-3 w-3" />
                          {t('roles.system')}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>{role.description || t('common.none')}</CardDescription>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" onClick={() => startEdit(role)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={role.is_system}
                        title={role.is_system ? t('roles.system') : t('common.delete')}
                        onClick={() => remove(role)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {role.permissions.includes(WILDCARD) ? (
                  <Badge>{t('roles.fullAccess')}</Badge>
                ) : role.permissions.length ? (
                  <div className="flex flex-wrap gap-1">
                    {role.permissions.map((p) => (
                      <Badge key={p} variant="outline">
                        {p}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{t('roles.noPermissions')}</span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {edit?.role ? t('roles.editRole', { name: edit.role.name }) : t('roles.newRole')}
            </DialogTitle>
            <DialogDescription>{t('roles.dialogHint')}</DialogDescription>
          </DialogHeader>

          {edit && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="role-name">{t('roles.name')}</Label>
                <Input
                  id="role-name"
                  value={edit.name}
                  disabled={nameLocked}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  placeholder={t('roles.namePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-desc">{t('roles.description')}</Label>
                <Input
                  id="role-desc"
                  value={edit.description}
                  onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                  placeholder={t('roles.descPlaceholder')}
                />
              </div>

              <div className="space-y-3">
                <Label>{t('roles.permissions')}</Label>
                {permsLocked ? (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                    {t('roles.adminLocked')}
                  </p>
                ) : (
                  catalog?.catalog.map((group) => (
                    <div key={group.resource} className="space-y-2">
                      <p className="text-sm font-medium">{group.label}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {group.actions.map((action) => {
                          const key = permKey(group.resource, action)
                          return (
                            <label key={key} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={edit.permissions.includes(key)}
                                onCheckedChange={(c) => togglePermission(key, c === true)}
                              />
                              <span className="capitalize">{action}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} disabled={saving || !edit?.name.trim()}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

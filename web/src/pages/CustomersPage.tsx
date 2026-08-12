import { useEffect, useMemo, useState } from 'react'
import { MoreHorizontal, Plus, Search, Pencil, Trash2, Users, SearchX } from 'lucide-react'
import {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  CUSTOMER_STATUSES,
  STATUS_VARIANT,
  type Customer,
  type CustomerInput,
  type CustomerStatus,
} from '@/lib/customers'
import { ApiError } from '@/lib/api'
import { formatMoney } from '@/lib/format'
import { initials } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { useAppSettings } from '@/context/AppSettingsContext'
import { PermissionGate } from '@/components/PermissionGate'
import { DataLoadError } from '@/components/DataLoadError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableEmptyState } from '@/components/ui/table-empty-state'
import { useTabParam } from '@/lib/use-tab-param'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const blankForm = (): CustomerInput => ({
  name: '',
  company: '',
  email: '',
  status: 'lead',
  mrr: 0,
  seats: 0,
})

export default function CustomersPage() {
  const { t } = useTranslation()
  const { settings } = useAppSettings()
  const currencySymbol = settings?.currency_symbol ?? '€'
  const [rows, setRows] = useState<Customer[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useTabParam<'all' | CustomerStatus>(['all', ...CUSTOMER_STATUSES], 'all')

  // edit/create dialog
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<CustomerInput>(blankForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    listCustomers()
      .then((data) => active && setRows(data))
      .catch((e) => {
        if (!active) return
        setLoadError(e)
        setRows([])
      })
    return () => {
      active = false
    }
  }, [])

  const filtered = useMemo(() => {
    const list = rows ?? []
    const q = query.trim().toLowerCase()
    return list.filter((c) => {
      const matchesTab = tab === 'all' || c.status === tab
      const matchesQuery =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      return matchesTab && matchesQuery
    })
  }, [rows, query, tab])

  const stats = useMemo(() => {
    const list = rows ?? []
    const active = list.filter((c) => c.status === 'active')
    return {
      total: list.length,
      active: active.length,
      mrr: active.reduce((sum, c) => sum + c.mrr, 0),
    }
  }, [rows])

  function openCreate() {
    setEditingId(null)
    setForm(blankForm())
    setFormError(null)
    setEditorOpen(true)
  }

  function openEdit(c: Customer) {
    setEditingId(c.id)
    setForm({
      name: c.name,
      company: c.company,
      email: c.email,
      status: c.status,
      mrr: c.mrr,
      seats: c.seats,
    })
    setFormError(null)
    setEditorOpen(true)
  }

  async function save() {
    if (!form.name.trim() || !form.email.trim()) return
    setSaving(true)
    setFormError(null)
    try {
      if (editingId !== null) {
        const updated = await updateCustomer(editingId, form)
        setRows((prev) => (prev ?? []).map((c) => (c.id === editingId ? updated : c)))
      } else {
        const created = await createCustomer(form)
        setRows((prev) => [created, ...(prev ?? [])])
      }
      setEditorOpen(false)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t('customers.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteCustomer(deleteTarget.id)
      setRows((prev) => (prev ?? []).filter((c) => c.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t('customers.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  const loading = rows === null

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('customers.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('customers.descriptionLead')} <code>/customers</code> {t('customers.descriptionTail')}
          </p>
        </div>
        <PermissionGate permission="customers:create">
          <Button onClick={openCreate} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            {t('customers.add')}
          </Button>
        </PermissionGate>
      </div>

      <DataLoadError error={loadError} />

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: t('customers.statTotal'), value: loading ? null : String(stats.total) },
          { label: t('customers.statActive'), value: loading ? null : String(stats.active) },
          { label: t('customers.statMrr'), value: loading ? null : formatMoney(stats.mrr, currencySymbol) },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
            </CardHeader>
            <CardContent>
              {s.value === null ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <p className="text-2xl font-semibold">{s.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar: search + status tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('customers.searchPlaceholder')}
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'all' | CustomerStatus)}
          className="-mx-4 max-w-full overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          <TabsList>
            <TabsTrigger value="all">{t('customers.all')}</TabsTrigger>
            {CUSTOMER_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {t(`customers.status.${s}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('customers.colCustomer')}</TableHead>
              <TableHead>{t('customers.colEmail')}</TableHead>
              <TableHead>{t('customers.colStatus')}</TableHead>
              <TableHead className="text-right">{t('customers.colMrr')}</TableHead>
              <TableHead className="text-right">{t('customers.colSeats')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-8" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              (rows?.length ?? 0) === 0 ? (
                <TableEmptyState
                  colSpan={6}
                  icon={Users}
                  title={t('customers.emptyTitle')}
                  description={t('customers.emptyDesc')}
                />
              ) : (
                <TableEmptyState
                  colSpan={6}
                  variant="search"
                  icon={SearchX}
                  title={t('customers.emptySearchTitle')}
                  description={t('customers.emptySearchDesc')}
                />
              )
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">{initials(c.name)}</AvatarFallback>
                      </Avatar>
                      <div className="leading-tight">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.company}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.email}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]}>{t(`customers.status.${c.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(c.mrr, currencySymbol)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.seats}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">{t('common.openMenu')}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <PermissionGate
                          permission="customers:update"
                          fallback={
                            <DropdownMenuItem disabled>
                              <Pencil className="mr-2 h-4 w-4" />
                              {t('common.edit')}
                            </DropdownMenuItem>
                          }
                        >
                          <DropdownMenuItem onClick={() => openEdit(c)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {t('common.edit')}
                          </DropdownMenuItem>
                        </PermissionGate>
                        <PermissionGate permission="customers:delete">
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(c)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('common.delete')}
                          </DropdownMenuItem>
                        </PermissionGate>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!loading && (
        <p className="text-xs text-muted-foreground">
          {t('customers.showing', { shown: filtered.length, total: rows?.length ?? 0 })}
        </p>
      )}

      {/* Create / edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId !== null ? t('customers.editTitle') : t('customers.add')}</DialogTitle>
            <DialogDescription>
              {editingId !== null ? t('customers.editDesc') : t('customers.createDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('customers.fieldName')}</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company">{t('customers.fieldCompany')}</Label>
                <Input id="company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('customers.fieldEmail')}</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="status">{t('customers.fieldStatus')}</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as CustomerStatus })}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{t(`customers.status.${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mrr">{t('customers.fieldMrr', { symbol: currencySymbol })}</Label>
                <Input id="mrr" type="number" min={0} value={form.mrr} onChange={(e) => setForm({ ...form, mrr: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seats">{t('customers.fieldSeats')}</Label>
                <Input id="seats" type="number" min={0} value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} />
              </div>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.email.trim()}>
              {saving ? t('common.saving') : editingId !== null ? t('customers.saveChanges') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('customers.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('customers.deleteConfirmLead')}{' '}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>{' '}
              {t('customers.deleteConfirmTail', { company: deleteTarget?.company ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? t('common.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

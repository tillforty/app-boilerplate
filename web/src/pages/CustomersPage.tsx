import { useEffect, useMemo, useState } from 'react'
import { MoreHorizontal, Plus, Search, Pencil, Trash2 } from 'lucide-react'
import {
  DEMO_CUSTOMERS,
  CUSTOMER_STATUSES,
  STATUS_LABEL,
  STATUS_VARIANT,
  type Customer,
  type CustomerStatus,
} from '@/lib/demo-data'
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

const money = (n: number) => `$${n.toLocaleString()}`
const initials = (name: string) =>
  name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'
const blankForm = (): Omit<Customer, 'id' | 'joined'> => ({
  name: '',
  company: '',
  email: '',
  status: 'lead',
  mrr: 0,
  seats: 0,
})

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[] | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | CustomerStatus>('all')

  // edit/create dialog
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(blankForm())

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setRows(DEMO_CUSTOMERS), 700)
    return () => clearTimeout(t)
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
    setEditorOpen(true)
  }

  function openEdit(c: Customer) {
    setEditingId(c.id)
    const { id: _id, joined: _joined, ...rest } = c
    void _id
    void _joined
    setForm(rest)
    setEditorOpen(true)
  }

  function save() {
    if (!form.name.trim() || !form.email.trim()) return
    setRows((prev) => {
      const list = prev ?? []
      if (editingId) {
        return list.map((c) => (c.id === editingId ? { ...c, ...form } : c))
      }
      const created: Customer = {
        ...form,
        id: `c-${Date.now()}`,
        joined: new Date().toISOString().slice(0, 10),
      }
      return [created, ...list]
    })
    setEditorOpen(false)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    setRows((prev) => (prev ?? []).filter((c) => c.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  const loading = rows === null

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            A CRM-style example: table, search, filters, tabs, and full CRUD on dummy data.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add customer
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total customers', value: loading ? null : String(stats.total) },
          { label: 'Active', value: loading ? null : String(stats.active) },
          { label: 'Active MRR', value: loading ? null : money(stats.mrr) },
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
            placeholder="Search name, company, email…"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | CustomerStatus)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {CUSTOMER_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>
                {STATUS_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead className="text-right">Seats</TableHead>
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
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No customers match your filters.
                </TableCell>
              </TableRow>
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
                    <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.mrr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.seats}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(c)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(c)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
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
          Showing {filtered.length} of {rows?.length ?? 0} customers.
        </p>
      )}

      {/* Create / edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit customer' : 'Add customer'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update this customer’s details.' : 'Create a new customer record.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company">Company</Label>
                <Input id="company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as CustomerStatus })}
                >
                  {CUSTOMER_STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mrr">MRR ($)</Label>
                <Input id="mrr" type="number" min={0} value={form.mrr} onChange={(e) => setForm({ ...form, mrr: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seats">Seats</Label>
                <Input id="seats" type="number" min={0} value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim() || !form.email.trim()}>
              {editingId ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete customer</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium text-foreground">{deleteTarget?.name}</span> from{' '}
              {deleteTarget?.company}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

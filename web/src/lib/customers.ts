/**
 * Customers API client — the CRM example page (pages/CustomersPage.tsx) is wired
 * to this. Mirrors the backend `customers` router (backend/app/customers.py).
 */
import { api } from './api'

export type CustomerStatus = 'active' | 'trial' | 'churned' | 'lead'

export interface Customer {
  id: number
  name: string
  company: string
  email: string
  status: CustomerStatus
  mrr: number // monthly recurring revenue, USD
  seats: number
  joined: string // ISO date, derived from created_at on the backend
}

export interface CustomerInput {
  name: string
  company: string
  email: string
  status: CustomerStatus
  mrr: number
  seats: number
}

export const CUSTOMER_STATUSES: CustomerStatus[] = ['active', 'trial', 'churned', 'lead']

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Active',
  trial: 'Trial',
  churned: 'Churned',
  lead: 'Lead',
}

/** Badge variant per status (maps to the shadcn Badge variants). */
export const STATUS_VARIANT: Record<
  CustomerStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  trial: 'secondary',
  churned: 'destructive',
  lead: 'outline',
}

export const listCustomers = () => api.get<Customer[]>('/customers')
export const getCustomer = (id: number) => api.get<Customer>(`/customers/${id}`)
/** Semantic search (falls back to keyword search server-side). */
export const searchCustomers = (q: string) =>
  api.get<Customer[]>(`/customers/search?q=${encodeURIComponent(q)}`)
export const createCustomer = (body: CustomerInput) => api.post<Customer>('/customers', body)
export const updateCustomer = (id: number, patch: Partial<CustomerInput>) =>
  api.patch<Customer>(`/customers/${id}`, patch)
export const deleteCustomer = (id: number) => api.delete<void>(`/customers/${id}`)

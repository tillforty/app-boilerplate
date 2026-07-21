/** Dashboard stats client — mirrors the backend `/stats` endpoint. */
import { api } from './api'

export interface Stats {
  users: number
  roles: number
  customers: number
  active_customers: number
  mrr: number // summed MRR of active customers, EUR
  files: number
}

export const getStats = () => api.get<Stats>('/stats')

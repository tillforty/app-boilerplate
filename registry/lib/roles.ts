import { api } from './api'

export const WILDCARD = '*'

export interface Role {
  id: number
  name: string
  description: string
  permissions: string[]
  is_system: boolean
  created_at: string
}

export interface PermissionGroup {
  resource: string
  label: string
  actions: string[]
}

export interface PermissionCatalog {
  catalog: PermissionGroup[]
  all: string[]
  wildcard: string
}

export interface MyRole {
  role: string | null
  permissions: string[]
}

export interface RoleInput {
  name: string
  description: string
  permissions: string[]
}

/** Build a permission key, e.g. permKey('users', 'read') -> 'users:read'. */
export function permKey(resource: string, action: string): string {
  return `${resource}:${action}`
}

/** True if `permissions` grants `perm` (directly or via the '*' wildcard). */
export function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes(WILDCARD) || permissions.includes(perm)
}

export const listRoles = () => api.get<Role[]>('/roles')
export const getRole = (id: number) => api.get<Role>(`/roles/${id}`)
export const getPermissionCatalog = () => api.get<PermissionCatalog>('/roles/permissions')
export const getMyRole = () => api.get<MyRole>('/roles/me')
export const createRole = (body: RoleInput) => api.post<Role>('/roles', body)
export const updateRole = (id: number, patch: Partial<RoleInput>) =>
  api.patch<Role>(`/roles/${id}`, patch)
export const deleteRole = (id: number) => api.delete<void>(`/roles/${id}`)
export const assignRole = (user_id: number, role_id: number) =>
  api.put<void>('/roles/assign', { user_id, role_id })

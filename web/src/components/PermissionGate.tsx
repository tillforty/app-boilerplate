import type { ReactNode } from 'react'
import { usePermissions } from '@/context/PermissionsContext'

interface PermissionGateProps {
  /** Permission key required to render the children, e.g. 'roles:manage'. */
  permission: string
  children: ReactNode
  /** Optional content shown when the user lacks the permission. */
  fallback?: ReactNode
}

/** Renders `children` only if the current user holds `permission`. */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const { can } = usePermissions()
  return <>{can(permission) ? children : fallback}</>
}

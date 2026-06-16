import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getMyRole, hasPermission } from '@/lib/roles'
import { useAuth } from '@/context/AuthContext'

interface PermissionsState {
  role: string | null
  permissions: string[]
  loading: boolean
  /** True if the current user has `perm` (or the '*' wildcard). */
  can: (perm: string) => boolean
  refresh: () => Promise<void>
}

const PermissionsContext = createContext<PermissionsState | undefined>(undefined)

/**
 * Loads the current user's role + effective permissions and exposes `can(perm)`.
 * Mount inside <AuthProvider> (it reacts to the logged-in user).
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [role, setRole] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    if (!user) {
      setRole(null)
      setPermissions([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const me = await getMyRole()
      setRole(me.role)
      setPermissions(me.permissions)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return (
    <PermissionsContext.Provider
      value={{ role, permissions, loading, can: (p) => hasPermission(permissions, p), refresh }}
    >
      {children}
    </PermissionsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePermissions(): PermissionsState {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider')
  return ctx
}

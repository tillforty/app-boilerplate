import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getDemoInfo } from '@/lib/auth'

interface DemoState {
  /** True when the backend runs with DEMO_MODE on (read-only public demo). */
  enabled: boolean
  username: string | null
  password: string | null
  loading: boolean
}

const DemoContext = createContext<DemoState | undefined>(undefined)

/**
 * Fetches DEMO_MODE status once (public `/auth/demo`) so any page can adapt —
 * e.g. show a "read-only demo" notice or disable writes like user invites.
 * Independent of auth: the flag is the same whether or not you're signed in.
 */
export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>({
    enabled: false,
    username: null,
    password: null,
    loading: true,
  })

  useEffect(() => {
    let active = true
    getDemoInfo()
      .then((d) => {
        if (!active) return
        setState({
          enabled: d.enabled,
          username: d.username ?? null,
          password: d.password ?? null,
          loading: false,
        })
      })
      .catch(() => {
        if (active) setState((s) => ({ ...s, loading: false }))
      })
    return () => {
      active = false
    }
  }, [])

  return <DemoContext.Provider value={state}>{children}</DemoContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDemo(): DemoState {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error('useDemo must be used within DemoProvider')
  return ctx
}

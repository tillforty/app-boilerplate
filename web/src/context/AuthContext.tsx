import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError } from '@/lib/api'
import {
  clearAuth,
  fetchMe,
  getStoredUser,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  type User,
} from '@/lib/auth'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser())
  const [loading, setLoading] = useState(true)

  // On first load, validate any stored token against the server.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    fetchMe()
      .then(setUser)
      .catch((err) => {
        // Only sign out if the token is genuinely rejected (401, or 403 when
        // the account was deactivated). Transient failures — network errors or
        // 5xx while the API restarts during a redeploy — must NOT drop the
        // session; keep the stored user.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearAuth()
          setUser(null)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  async function login(email: string, password: string) {
    setUser(await apiLogin(email, password))
  }

  function logout() {
    void apiLogout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getSettings, type PublicSettings } from '@/lib/settings'

interface AppSettingsState {
  /** Public runtime settings, or null until the first fetch resolves. */
  settings: PublicSettings | null
  loading: boolean
  /** Re-fetch (e.g. after onboarding or a settings edit). */
  refresh: () => void
}

const AppSettingsContext = createContext<AppSettingsState | undefined>(undefined)

/**
 * Fetches the public runtime settings once (GET /settings) so the whole app can
 * read the app name, logo, default language, currency, timezone and demo flag,
 * and so the onboarding gate knows whether this instance is set up yet.
 */
export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    getSettings()
      .then((s) => {
        if (!active) return
        setSettings(s)
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [tick])

  // Keep the browser tab title in sync with the configured app name.
  useEffect(() => {
    if (settings?.app_name) document.title = settings.app_name
  }, [settings?.app_name])

  const refresh = () => setTick((t) => t + 1)

  return (
    <AppSettingsContext.Provider value={{ settings, loading, refresh }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppSettings(): AppSettingsState {
  const ctx = useContext(AppSettingsContext)
  if (!ctx) throw new Error('useAppSettings must be used within AppSettingsProvider')
  return ctx
}

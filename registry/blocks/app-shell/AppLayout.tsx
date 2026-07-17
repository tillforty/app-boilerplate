import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import { applyBrandTheme } from '@/config/app-config'

export default function AppLayout() {
  // Apply the configured primary color system-wide. (Also call applyBrandTheme()
  // in main.tsx so the login screen picks it up before this layout mounts.)
  useEffect(() => {
    applyBrandTheme()
  }, [])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <Header />
      <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  )
}

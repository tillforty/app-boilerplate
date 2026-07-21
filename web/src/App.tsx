import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import ProtectedRoute from '@/components/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import OAuthCallback from '@/pages/OAuthCallback'
import OnboardingPage from '@/pages/OnboardingPage'
import DashboardPage from '@/pages/DashboardPage'
import CustomersPage from '@/pages/CustomersPage'
import ComponentsPage from '@/pages/ComponentsPage'
import UsersPage from '@/pages/UsersPage'
import RolesPage from '@/pages/RolesPage'
import ProfilePage from '@/pages/ProfilePage'
import DocumentsPage from '@/pages/DocumentsPage'
import InvitePage from '@/pages/InvitePage'
import { useAppSettings } from '@/context/AppSettingsContext'
import { useTranslation } from '@/i18n'

export default function App() {
  const { settings, loading } = useAppSettings()
  const { setLanguage } = useTranslation()
  const location = useLocation()

  // Apply the configured default language when the visitor has no saved choice.
  useEffect(() => {
    if (settings && !localStorage.getItem('tf_lang')) {
      setLanguage(settings.default_language)
    }
  }, [settings, setLanguage])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    )
  }

  // Fresh instance (settings row exists but not onboarded): funnel everything —
  // including /login — to the wizard. Once onboarded, /onboarding bounces away.
  if (settings && !settings.onboarded && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  if (settings?.onboarded && location.pathname === '/onboarding') {
    return <Navigate to="/login" replace />
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      {/* Authenticated app shell */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/components" element={<ComponentsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings/users" element={<UsersPage />} />
          <Route path="/settings/roles" element={<RolesPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

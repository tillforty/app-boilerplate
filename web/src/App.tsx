import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import ProtectedRoute from '@/components/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'
import { useAppSettings } from '@/context/AppSettingsContext'
import { useTranslation } from '@/i18n'

// Route-level code-splitting: each page ships in its own chunk and loads on
// demand, so the initial bundle (and heavy deps like charts) no longer land on
// first paint / the login screen.
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const OAuthCallback = lazy(() => import('@/pages/OAuthCallback'))
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'))
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const CustomersPage = lazy(() => import('@/pages/CustomersPage'))
const ComponentsPage = lazy(() => import('@/pages/ComponentsPage'))
const UsersPage = lazy(() => import('@/pages/UsersPage'))
const RolesPage = lazy(() => import('@/pages/RolesPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const DocumentsPage = lazy(() => import('@/pages/DocumentsPage'))
const DevelopmentPage = lazy(() => import('@/pages/DevelopmentPage'))
const InvitePage = lazy(() => import('@/pages/InvitePage'))

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  )
}

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
    return <PageFallback />
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
    <Suspense fallback={<PageFallback />}>
    <Routes>
      {/* Public */}
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      {/* Authenticated app shell */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          {/* Dashboard views are addressable: /dashboard/overview, /dashboard/sales, … */}
          <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
          <Route path="/dashboard" element={<Navigate to="/dashboard/overview" replace />} />
          <Route path="/dashboard/:view" element={<DashboardPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/components" element={<ComponentsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/development" element={<DevelopmentPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings/users" element={<UsersPage />} />
          <Route path="/settings/roles" element={<RolesPage />} />
          <Route path="/settings/app" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>
  )
}

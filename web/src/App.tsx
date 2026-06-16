import { Route, Routes } from 'react-router-dom'
import ProtectedRoute from '@/components/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import OAuthCallback from '@/pages/OAuthCallback'
import DashboardPage from '@/pages/DashboardPage'
import CustomersPage from '@/pages/CustomersPage'
import ComponentsPage from '@/pages/ComponentsPage'
import UsersPage from '@/pages/UsersPage'
import RolesPage from '@/pages/RolesPage'
import ProfilePage from '@/pages/ProfilePage'

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />

      {/* Authenticated app shell */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/components" element={<ComponentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings/users" element={<UsersPage />} />
          <Route path="/settings/roles" element={<RolesPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

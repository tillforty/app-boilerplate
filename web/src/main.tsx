import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { I18nProvider } from '@/i18n'
import { AuthProvider } from '@/context/AuthContext'
import { PermissionsProvider } from '@/context/PermissionsContext'
import { DemoProvider } from '@/context/DemoContext'
import { applyBrandTheme } from '@/config/app-config'

// Apply the configured brand primary color before first paint so even the login
// screen picks it up (the app shell re-applies it on mount).
applyBrandTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <DemoProvider>
          <AuthProvider>
            <PermissionsProvider>
              <App />
            </PermissionsProvider>
          </AuthProvider>
        </DemoProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)

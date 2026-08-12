import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { I18nProvider } from '@/i18n'
import { AuthProvider } from '@/context/AuthContext'
import { PermissionsProvider } from '@/context/PermissionsContext'
import { DemoProvider } from '@/context/DemoContext'
import { AppSettingsProvider } from '@/context/AppSettingsContext'
import { applyBrandTheme } from '@/config/app-config'
import { initObservability, ErrorBoundary } from '@/lib/observability'

// Apply the configured brand primary color before first paint so even the login
// screen picks it up (the app shell re-applies it on mount).
applyBrandTheme()

// Start error capture as early as possible (no-op when VITE_SENTRY_DSN is unset).
initObservability()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui' }}>
          <p>Something went wrong. Please reload the page.</p>
        </div>
      }
    >
      <I18nProvider>
        <BrowserRouter>
          <AppSettingsProvider>
            <DemoProvider>
              <AuthProvider>
                <PermissionsProvider>
                  <App />
                </PermissionsProvider>
              </AuthProvider>
            </DemoProvider>
          </AppSettingsProvider>
        </BrowserRouter>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)

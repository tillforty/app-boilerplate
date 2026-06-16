/**
 * Per-app branding + navigation for the app-shell block.
 *
 * This is the ONE file each consuming app is expected to edit. The Header and
 * Sidebar read everything from here, so the shell itself stays generic and can
 * be pulled/updated from the registry without clobbering your branding.
 */
import { LayoutDashboard, Users, Shield, BookOpen, type LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Open in a new tab via <a> instead of client-side routing (e.g. API docs). */
  external?: boolean
}

export interface AppConfig {
  brand: {
    /** Shown in the header and expanded sidebar. */
    name: string
    /** Public path to the logo image (e.g. '/logo.png' in /public). */
    logoSrc: string
    /** Single-letter fallback shown when the sidebar is collapsed. */
    initial: string
    /**
     * System-wide primary color as HSL channels "H S% L%" (matches the
     * --primary CSS variable). Applied at runtime by applyBrandTheme().
     */
    primary: string
  }
  /** Primary horizontal/vertical nav. */
  nav: NavItem[]
  /** Secondary "Settings" group. */
  settingsNav: NavItem[]
  /** Where the "API Docs" links point (served by the backend, default /api/docs). */
  apiDocsUrl: string
}

export const appConfig: AppConfig = {
  brand: {
    name: 'Tillforty',
    logoSrc: '/logo.png',
    initial: 'T',
    primary: '18 91.5% 46.1%',
  },
  nav: [{ label: 'Dashboard', href: '/', icon: LayoutDashboard }],
  settingsNav: [
    { label: 'Users', href: '/settings/users', icon: Users },
    { label: 'Roles', href: '/settings/roles', icon: Shield },
    { label: 'API Docs', href: '/api/docs', icon: BookOpen, external: true },
  ],
  apiDocsUrl: '/api/docs',
}

/**
 * Apply the brand primary color to the CSS variables at runtime. Call once at
 * startup (e.g. in main.tsx) so it also covers the login screen, then the whole
 * system follows `brand.primary` without editing the theme tokens.
 */
export function applyBrandTheme(config: AppConfig = appConfig): void {
  const root = document.documentElement
  for (const v of ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring']) {
    root.style.setProperty(v, config.brand.primary)
  }
}

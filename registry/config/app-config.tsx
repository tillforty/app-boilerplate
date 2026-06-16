/**
 * Per-app branding + navigation for the app-shell block.
 *
 * This is the ONE file each consuming app is expected to edit. The Header and
 * Sidebar read everything from here, so the shell itself stays generic and can
 * be pulled/updated from the registry without clobbering your branding.
 */
import { LayoutDashboard, Users, type LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

export interface AppConfig {
  brand: {
    /** Shown in the header and expanded sidebar. */
    name: string
    /** Public path to the logo image (e.g. '/logo.png' in /public). */
    logoSrc: string
    /** Single-letter fallback shown when the sidebar is collapsed. */
    initial: string
  }
  /** Primary horizontal/vertical nav. */
  nav: NavItem[]
  /** Secondary "Settings" group. */
  settingsNav: NavItem[]
}

export const appConfig: AppConfig = {
  brand: {
    name: 'Tillforty',
    logoSrc: '/logo.png',
    initial: 'T',
  },
  nav: [{ label: 'Dashboard', href: '/', icon: LayoutDashboard }],
  settingsNav: [{ label: 'Users', href: '/settings/users', icon: Users }],
}

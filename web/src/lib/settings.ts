import { api } from './api'
import type { Language } from '@/i18n'

/** Public runtime settings the SPA bootstraps with (no secrets, no logo bytes). */
export interface PublicSettings {
  onboarded: boolean
  app_name: string
  has_logo: boolean
  logo_url: string | null
  default_language: Language
  currency_code: string
  currency_symbol: string
  timezone: string
  demo_enabled: boolean
}

export const getSettings = () => api.get<PublicSettings>('/settings')

export interface OnboardPayload {
  app_name: string
  default_language: Language
  currency_code: string
  currency_symbol: string
  timezone: string
  demo_mode: boolean
  from_name: string
  from_email: string
  support_email: string
  admin_name: string
  admin_surname: string
  admin_email: string
  admin_password: string
  logo: File | null
}

/** First-run wizard submit — multipart because of the logo file. */
export async function submitOnboarding(p: OnboardPayload): Promise<void> {
  const fd = new FormData()
  fd.append('app_name', p.app_name)
  fd.append('default_language', p.default_language)
  fd.append('currency_code', p.currency_code)
  fd.append('currency_symbol', p.currency_symbol)
  fd.append('timezone', p.timezone)
  fd.append('demo_mode', String(p.demo_mode))
  fd.append('from_name', p.from_name)
  fd.append('from_email', p.from_email)
  fd.append('support_email', p.support_email)
  fd.append('admin_name', p.admin_name)
  fd.append('admin_surname', p.admin_surname)
  fd.append('admin_email', p.admin_email)
  fd.append('admin_password', p.admin_password)
  if (p.logo) fd.append('logo', p.logo)
  await api.upload<void>('/settings/onboard', fd)
}

export interface SettingsPatch {
  app_name?: string
  default_language?: Language
  currency_code?: string
  currency_symbol?: string
  timezone?: string
  demo_mode?: boolean
  from_name?: string
  from_email?: string
  support_email?: string
}

export const updateSettings = (patch: SettingsPatch) =>
  api.patch<PublicSettings>('/settings', patch)

import { api } from './api'
import type { Language } from '@/i18n'

/** Currency presets offered in the onboarding + settings forms. */
export const CURRENCY_PRESETS: { code: string; symbol: string }[] = [
  { code: 'EUR', symbol: '€' },
  { code: 'USD', symbol: '$' },
  { code: 'GBP', symbol: '£' },
  { code: 'PLN', symbol: 'zł' },
  { code: 'SEK', symbol: 'kr' },
]

/** Common IANA timezones offered in the pickers (default first). */
export const COMMON_TIMEZONES = [
  'Europe/Vilnius',
  'Europe/Riga',
  'Europe/Tallinn',
  'Europe/Warsaw',
  'Europe/Helsinki',
  'Europe/London',
  'Europe/Berlin',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
]

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
  /** Sender prefill defaults — present only before onboarding. */
  default_from_name?: string | null
  default_from_email?: string | null
  default_support_email?: string | null
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

/** Full editable settings for the admin edit page (auth required). */
export interface AdminSettings {
  app_name: string
  default_language: Language
  currency_code: string
  currency_symbol: string
  timezone: string
  demo_mode: boolean
  from_name: string
  from_email: string
  support_email: string
  has_logo: boolean
  logo_url: string | null
}

export const getAdminSettings = () => api.get<AdminSettings>('/settings/admin')

export async function uploadLogo(file: File): Promise<void> {
  const fd = new FormData()
  fd.append('logo', file)
  await api.upload<void>('/settings/logo', fd)
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

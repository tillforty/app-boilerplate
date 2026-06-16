/**
 * Lightweight i18n — no dependencies.
 *
 * Usage:
 *   <I18nProvider><App /></I18nProvider>
 *   const { t } = useTranslation();  t('roles.title')
 *
 * Add a language: create a dictionary file with the same shape as `en`, then
 * register it in `dictionaries` + `LANGUAGE_LABELS` below. English is the
 * default and the fallback for any missing key.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { en, type Dictionary } from './en'

export type Language = 'en'

/** Registered dictionaries. Add more languages here. */
const dictionaries: Record<Language, Dictionary> = { en }

/** Human-readable names shown in the language switcher. */
export const LANGUAGE_LABELS: Record<Language, string> = { en: 'English' }

const DEFAULT_LANGUAGE: Language = 'en'
const STORAGE_KEY = 'tf_lang'

type Vars = Record<string, string | number>

interface I18nState {
  language: Language
  setLanguage: (lang: Language) => void
  languages: Language[]
  t: (key: string, vars?: Vars) => string
}

const I18nContext = createContext<I18nState | undefined>(undefined)

function resolve(dict: Dictionary, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      dict,
    )
  // Fall back to English, then to the raw key, if missing.
  if (typeof value === 'string') return value
  const fallback = key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      en,
    )
  return typeof fallback === 'string' ? fallback : key
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLang] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null
    return stored && stored in dictionaries ? stored : DEFAULT_LANGUAGE
  })

  const setLanguage = useCallback((lang: Language) => {
    localStorage.setItem(STORAGE_KEY, lang)
    setLang(lang)
  }, [])

  const t = useCallback(
    (key: string, vars?: Vars) => interpolate(resolve(dictionaries[language], key), vars),
    [language],
  )

  const value = useMemo<I18nState>(
    () => ({ language, setLanguage, languages: Object.keys(dictionaries) as Language[], t }),
    [language, setLanguage, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation(): I18nState {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider')
  return ctx
}

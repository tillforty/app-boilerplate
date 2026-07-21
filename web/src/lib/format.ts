/**
 * Shared formatters driven by the runtime app settings (currency + timezone),
 * so money and dates render consistently everywhere instead of via per-page
 * hardcoded helpers. Pull the values from `useAppSettings()` at the call site.
 */

/** e.g. formatMoney(1234, '€') -> '€1,234'. */
export function formatMoney(amount: number, currencySymbol: string): string {
  return `${currencySymbol}${amount.toLocaleString()}`
}

/** Localized date in the configured timezone. Falls back to '—' on bad input. */
export function formatDate(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone,
      })
}

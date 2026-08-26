import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney } from './format'

describe('formatMoney', () => {
  it('prefixes the currency symbol', () => {
    expect(formatMoney(1234, '€')).toBe(`€${(1234).toLocaleString()}`)
  })

  it('handles zero and negative amounts', () => {
    expect(formatMoney(0, '$')).toBe('$0')
    expect(formatMoney(-5, '$')).toBe(`$${(-5).toLocaleString()}`)
  })
})

describe('formatDate', () => {
  it('renders a valid ISO date in the given timezone', () => {
    const out = formatDate('2026-01-15T12:00:00Z', 'UTC')
    expect(out).toContain('2026')
    expect(out).toContain('15')
  })

  it('respects the timezone for dates near midnight', () => {
    // 23:30 UTC on the 15th is already the 16th in Tokyo.
    expect(formatDate('2026-01-15T23:30:00Z', 'Asia/Tokyo')).toContain('16')
    expect(formatDate('2026-01-15T23:30:00Z', 'UTC')).toContain('15')
  })

  it('falls back to an em dash on unparsable input', () => {
    expect(formatDate('not-a-date')).toBe('—')
    expect(formatDate('')).toBe('—')
  })
})

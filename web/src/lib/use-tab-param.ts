import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Syncs a tab selection to a URL query param (default `?tab=`) so tabs are
 * bookmarkable, shareable, and survive a page refresh.
 *
 * - Falls back to `defaultValue` when the param is missing or not one of
 *   `allowed` (guards against a hand-edited/bogus URL).
 * - Selecting the default clears the param to keep URLs clean.
 * - Uses `replace` so switching tabs doesn't stack up back-button history.
 *
 * Returns a `[value, setValue]` pair with the same shape as `useState`.
 */
export function useTabParam<T extends string>(
  allowed: readonly T[],
  defaultValue: T,
  key = 'tab',
): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : defaultValue

  const setValue = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === defaultValue) p.delete(key)
          else p.set(key, next)
          return p
        },
        { replace: true },
      )
    },
    [setParams, defaultValue, key],
  )

  return [value, setValue]
}

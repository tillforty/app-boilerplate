import { describe, expect, it } from 'vitest'
import { cn, initials } from './utils'

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('lets later tailwind classes override earlier conflicting ones', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, null)).toBe('a')
  })
})

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Jane Doe')).toBe('JD')
    expect(initials('Ada Lovelace King')).toBe('AL')
  })

  it('handles a single name', () => {
    expect(initials('Jane')).toBe('J')
  })

  it('uppercases', () => {
    expect(initials('jane doe')).toBe('JD')
  })

  it('falls back to ? for an empty name', () => {
    expect(initials('')).toBe('?')
  })
})

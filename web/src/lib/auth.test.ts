import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOKEN_KEY } from './api'
import {
  clearAuth,
  completeOAuthLogin,
  getStoredUser,
  getToken,
  login,
  logout,
} from './auth'

const USER_KEY = 'tf_user'
const user = { id: 7, name: 'Jane', surname: 'Doe', email: 'jane@example.com' }

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('stored auth state', () => {
  it('getStoredUser returns the parsed user', () => {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    expect(getStoredUser()).toEqual(user)
  })

  it('getStoredUser returns null when nothing is stored', () => {
    expect(getStoredUser()).toBeNull()
  })

  it('getStoredUser tolerates corrupted JSON instead of throwing', () => {
    localStorage.setItem(USER_KEY, '{not json')
    expect(getStoredUser()).toBeNull()
  })

  it('clearAuth removes both token and user', () => {
    localStorage.setItem(TOKEN_KEY, 'tok')
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    clearAuth()
    expect(getToken()).toBeNull()
    expect(getStoredUser()).toBeNull()
  })
})

describe('login/logout', () => {
  it('login stores the token and user', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ access_token: 'tok-abc', token_type: 'bearer', user }),
    )
    await expect(login('jane@example.com', 'pw')).resolves.toEqual(user)
    expect(getToken()).toBe('tok-abc')
    expect(getStoredUser()).toEqual(user)
  })

  it('failed login stores nothing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Invalid email or password' }, 401))
    await expect(login('jane@example.com', 'wrong')).rejects.toThrow()
    expect(getToken()).toBeNull()
    expect(getStoredUser()).toBeNull()
  })

  it('logout clears local state even when the server call fails', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok')
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    fetchMock.mockRejectedValue(new TypeError('network down'))
    await logout()
    expect(getToken()).toBeNull()
    expect(getStoredUser()).toBeNull()
  })
})

describe('completeOAuthLogin', () => {
  it('stores the callback token, then loads and stores the user', async () => {
    fetchMock.mockResolvedValue(jsonResponse(user))
    await expect(completeOAuthLogin('sso-tok')).resolves.toEqual(user)
    expect(getToken()).toBe('sso-tok')
    expect(getStoredUser()).toEqual(user)
    // /auth/me must have been called with the token that was just stored.
    const [path, options] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/auth/me')
    expect(options.headers.Authorization).toBe('Bearer sso-tok')
  })
})

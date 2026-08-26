import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, apiFetch, ApiError, TOKEN_KEY } from './api'

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

describe('apiFetch', () => {
  it('returns the parsed JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }))
    await expect(apiFetch('/thing')).resolves.toEqual({ id: 1 })
  })

  it('prefixes paths with /api', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiFetch('/auth/me')
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.anything())
  })

  it('attaches the bearer token from localStorage', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-123')
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiFetch('/thing')
    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer tok-123')
  })

  it('sends no Authorization header when logged out', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await apiFetch('/thing')
    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('resolves to undefined on 204 No Content', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiFetch('/thing')).resolves.toBeUndefined()
  })

  it('throws ApiError carrying the backend detail message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Secret not found' }, 404))
    const err = (await apiFetch('/thing').catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Secret not found')
  })

  it('falls back to HTTP <status> when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 502 }))
    const err = (await apiFetch('/thing').catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('HTTP 502')
  })
})

describe('api helpers', () => {
  it('api.post serializes the body and sets the method', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await api.post('/auth/login', { email: 'a@b.c', password: 'pw' })
    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ email: 'a@b.c', password: 'pw' })
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('api.delete sets the DELETE method', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await api.delete('/files/1')
    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('DELETE')
  })
})

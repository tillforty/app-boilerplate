const API_BASE = '/api'

/** localStorage key for the JWT access token. */
export const TOKEN_KEY = 'tf_token'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body.detail ?? body.message ?? message
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  })
  return handleResponse<T>(res)
}

/** POST multipart/form-data. Content-Type is left unset so the browser adds
 *  the correct multipart boundary. */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })
  return handleResponse<T>(res)
}

/** GET a binary response (e.g. a stored file) with auth, as a Blob. */
export async function apiBlob(path: string): Promise<Blob> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`)
  return res.blob()
}

export const api = {
  get: <T>(path: string, options?: RequestInit) =>
    apiFetch<T>(path, { method: 'GET', ...options }),
  upload: apiUpload,
  blob: apiBlob,
  post: <T>(path: string, body: unknown, options?: RequestInit) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      ...options,
    }),
  put: <T>(path: string, body: unknown, options?: RequestInit) =>
    apiFetch<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
      ...options,
    }),
  patch: <T>(path: string, body: unknown, options?: RequestInit) =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...options,
    }),
  delete: <T>(path: string, options?: RequestInit) =>
    apiFetch<T>(path, { method: 'DELETE', ...options }),
}

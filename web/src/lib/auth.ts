import { api, TOKEN_KEY } from './api'

export interface User {
  id: number
  name: string
  surname: string
  email: string
}

interface LoginResponse {
  access_token: string
  token_type: string
  user: User
}

const USER_KEY = 'tf_user'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

function store(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export async function login(email: string, password: string): Promise<User> {
  const res = await api.post<LoginResponse>('/auth/login', { email, password })
  store(res.access_token, res.user)
  return res.user
}

export async function logout(): Promise<void> {
  // Best-effort: clear the server-side docs cookie, then drop local state.
  try {
    await api.post<void>('/auth/logout', {})
  } catch {
    // ignore — we still clear local auth below
  }
  clearAuth()
}

export async function fetchMe(): Promise<User> {
  return api.get<User>('/auth/me')
}

export async function updateProfile(
  patch: Partial<Pick<User, 'name' | 'surname' | 'email'>>,
): Promise<User> {
  const user = await api.patch<User>('/auth/me', patch)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  return user
}

export async function changePassword(
  current_password: string,
  new_password: string,
): Promise<void> {
  await api.post<void>('/auth/change-password', { current_password, new_password })
}

/** A row in the users admin table: identity + role name + join date. */
export interface UserRow extends User {
  role: string | null
  created_at: string
}

export async function listUsers(): Promise<UserRow[]> {
  return api.get<UserRow[]>('/auth/users')
}

export interface AuthProvider {
  id: string // 'google' | 'microsoft' | ...
  name: string
}

/** Which SSO providers the backend has configured (empty if none). */
export async function getAuthProviders(): Promise<AuthProvider[]> {
  return api.get<AuthProvider[]>('/auth/oauth/providers')
}

/** Full-page URL that kicks off the provider's OAuth flow. */
export function oauthLoginUrl(provider: string): string {
  return `/api/auth/oauth/${provider}/login`
}

/** Finish an SSO login: store the token from the callback, then load the user. */
export async function completeOAuthLogin(token: string): Promise<User> {
  localStorage.setItem(TOKEN_KEY, token)
  const user = await fetchMe()
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  return user
}

export interface InviteOut {
  id: number
  email: string
  role_id: number | null
  role_name: string | null
  invited_by_name: string | null
  expires_at: string
  created_at: string
  invite_url: string
  email_sent: boolean
}

export interface InviteInfo {
  email: string
  role_name: string | null
  expires_at: string
}

export async function sendInvite(email: string, role_id?: number): Promise<InviteOut> {
  return api.post<InviteOut>('/auth/invites', { email, role_id: role_id ?? null })
}

export async function listInvites(): Promise<InviteOut[]> {
  return api.get<InviteOut[]>('/auth/invites')
}

export async function getInvite(token: string): Promise<InviteInfo> {
  return api.get<InviteInfo>(`/auth/invites/${token}`)
}

export async function acceptInvite(
  token: string,
  data: { name: string; surname: string; password: string },
): Promise<{ message: string }> {
  return api.post<{ message: string }>(`/auth/invites/${token}/accept`, data)
}

export interface DemoInfo {
  enabled: boolean
  username?: string | null
  password?: string | null
}

/** Demo-mode status + the public demo credentials (when DEMO_MODE is on). */
export async function getDemoInfo(): Promise<DemoInfo> {
  return api.get<DemoInfo>('/auth/demo')
}

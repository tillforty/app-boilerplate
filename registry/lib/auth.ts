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

export type UserStatus = 'active' | 'pending' | 'inactive'

/** A row in the users admin table: identity + role name + lifecycle status. */
export interface UserRow extends User {
  role: string | null
  status: UserStatus
  /** Only present on pending users, and only for callers with 'users:create'. */
  invite_token: string | null
  created_at: string
}

export async function listUsers(): Promise<UserRow[]> {
  return api.get<UserRow[]>('/auth/users')
}

export interface NewUser {
  name: string
  surname: string
  email: string
  password: string
  role_id?: number // defaults to the 'member' role on the backend
}

/** Admin-create a user (requires the 'users:create' permission). */
export async function createUser(body: NewUser): Promise<UserRow> {
  return api.post<UserRow>('/auth/users', body)
}

export interface InviteResult extends UserRow {
  invite_url: string
  email_sent: boolean
}

/** Invite a user by email: they arrive as 'pending' until they accept. */
export async function inviteUser(body: Omit<NewUser, 'password'>): Promise<InviteResult> {
  return api.post<InviteResult>('/auth/users/invite', body)
}

/** Issue a fresh invite token (and re-email it when SMTP is configured). */
export async function resendInvite(userId: number): Promise<InviteResult> {
  return api.post<InviteResult>(`/auth/users/${userId}/invite/resend`, {})
}

/** Archive a user (soft delete): keeps their data, blocks their login. */
export async function deactivateUser(userId: number): Promise<void> {
  await api.post<void>(`/auth/users/${userId}/deactivate`, {})
}

/** Restore an inactive user (back to pending if they never set a password). */
export async function activateUser(userId: number): Promise<void> {
  await api.post<void>(`/auth/users/${userId}/activate`, {})
}

/** The browser-facing URL of the public acceptance page for an invite token. */
export function inviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`
}

export interface InviteInfo {
  name: string
  surname: string
  email: string
}

/** Public: who an invitation is for (404 = invalid, 410 = expired). */
export async function getInvite(token: string): Promise<InviteInfo> {
  return api.get<InviteInfo>(`/auth/invite/${token}`)
}

/** Public: accept an invitation — sets the password and logs the user in. */
export async function acceptInvite(token: string, password: string): Promise<User> {
  const res = await api.post<LoginResponse>(`/auth/invite/${token}/accept`, { password })
  store(res.access_token, res.user)
  return res.user
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

export interface DemoInfo {
  enabled: boolean
  username?: string | null
  password?: string | null
}

/** Demo-mode status + the public demo credentials (when DEMO_MODE is on). */
export async function getDemoInfo(): Promise<DemoInfo> {
  return api.get<DemoInfo>('/auth/demo')
}

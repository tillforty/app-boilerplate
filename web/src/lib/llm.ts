import { api } from './api'

export type Capability = 'chat' | 'embeddings' | 'coding_agent'

/** How a connection authenticates: a provider API key, or a Claude plan token. */
export type AuthMode = 'api_key' | 'subscription'

export interface Provider {
  key: string
  label: string
  capabilities: Capability[]
  supports_base_url: boolean
  /** Auth modes this provider offers; always includes 'api_key'. */
  auth_modes: AuthMode[]
  /** Capabilities a subscription connection can serve (coding agents only). */
  subscription_capabilities: Capability[]
  chat_models: string[]
  embedding_models: string[]
  /** Models offered to the headless coding CLIs (Claude Code / Codex). */
  coding_models?: string[]
}

/** A saved provider connection. The secret is never returned — only has_key. */
export interface Credential {
  id: number
  provider: string
  label: string
  base_url: string | null
  default_model: string | null
  auth_mode: AuthMode
  has_key: boolean
}

export interface CredentialCreate {
  provider: string
  label: string
  base_url?: string | null
  default_model?: string | null
  auth_mode: AuthMode
  /** API key, or the subscription OAuth token when auth_mode is 'subscription'. */
  api_key?: string
  /** A finished browser sign-in whose token the server already holds. */
  token_flow_id?: number
}

export type TokenFlowState =
  | 'requested'
  | 'awaiting_code'
  | 'code_submitted'
  | 'done'
  | 'failed'

/** A Claude browser sign-in in progress. The token itself stays server-side. */
export interface TokenFlow {
  id: number
  state: TokenFlowState
  url: string | null
  error: string | null
}

export interface CredentialUpdate {
  label?: string
  base_url?: string | null
  default_model?: string | null
  /** Non-empty rotates the stored key; omit/blank keeps the existing one. */
  api_key?: string
  /** Or rotate it from a finished browser sign-in. */
  token_flow_id?: number
}

/** An app AI function and its current provider/model binding. */
export interface FunctionBinding {
  key: string
  label: string
  description: string
  capability: Capability
  credential_id: number | null
  model: string | null
}

export const getProviders = () => api.get<{ providers: Provider[] }>('/llm/providers')

export const listCredentials = () => api.get<Credential[]>('/llm/credentials')
export const createCredential = (body: CredentialCreate) =>
  api.post<Credential>('/llm/credentials', body)
export const updateCredential = (id: number, body: CredentialUpdate) =>
  api.patch<Credential>(`/llm/credentials/${id}`, body)
export const deleteCredential = (id: number) => api.delete<void>(`/llm/credentials/${id}`)
export const testCredential = (id: number) =>
  api.post<{ ok: boolean; error: string | null }>(`/llm/credentials/${id}/test`, {})

/** Ask the agent runner to start `claude setup-token` and report its URL. */
export const startTokenFlow = () => api.post<TokenFlow>('/llm/subscription/flows', {})
export const getTokenFlow = (id: number) => api.get<TokenFlow>(`/llm/subscription/flows/${id}`)
export const submitTokenFlowCode = (id: number, code: string) =>
  api.post<TokenFlow>(`/llm/subscription/flows/${id}/code`, { code })

export const listFunctions = () => api.get<FunctionBinding[]>('/llm/functions')
export const setFunctionBinding = (
  key: string,
  body: { credential_id: number | null; model: string | null },
) => api.put<FunctionBinding>(`/llm/functions/${key}`, body)

/** Models a provider offers for a given capability. */
export function modelsFor(provider: Provider | undefined, capability: Capability): string[] {
  if (!provider) return []
  if (capability === 'embeddings') return provider.embedding_models
  if (capability === 'coding_agent') return provider.coding_models ?? []
  return provider.chat_models
}

/**
 * The catalog plus `current`, when `current` is a model the catalog doesn't list.
 * Keeps a legacy or hand-entered model selectable after the picker became a list,
 * so opening an old connection doesn't silently reset it.
 */
export function withCurrentModel(models: string[], current: string): string[] {
  if (!current || models.includes(current)) return models
  return [current, ...models]
}

/** Whether a connection can be bound to a function with this capability. */
export function credentialServes(
  cred: Credential,
  provider: Provider | undefined,
  capability: Capability,
): boolean {
  if (!provider?.capabilities.includes(capability)) return false
  if (cred.auth_mode === 'subscription') {
    return provider.subscription_capabilities.includes(capability)
  }
  return true
}

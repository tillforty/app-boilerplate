import { api } from './api'

export type Capability = 'chat' | 'embeddings'

export interface Provider {
  key: string
  label: string
  capabilities: Capability[]
  supports_base_url: boolean
  chat_models: string[]
  embedding_models: string[]
}

/** A saved provider connection. The API key is never returned — only has_key. */
export interface Credential {
  id: number
  provider: string
  label: string
  base_url: string | null
  default_model: string | null
  has_key: boolean
}

export interface CredentialCreate {
  provider: string
  label: string
  base_url?: string | null
  default_model?: string | null
  api_key: string
}

export interface CredentialUpdate {
  label?: string
  base_url?: string | null
  default_model?: string | null
  /** Non-empty rotates the stored key; omit/blank keeps the existing one. */
  api_key?: string
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

export const listFunctions = () => api.get<FunctionBinding[]>('/llm/functions')
export const setFunctionBinding = (
  key: string,
  body: { credential_id: number | null; model: string | null },
) => api.put<FunctionBinding>(`/llm/functions/${key}`, body)

/** Models a provider offers for a given capability (chat or embeddings). */
export function modelsFor(provider: Provider | undefined, capability: Capability): string[] {
  if (!provider) return []
  return capability === 'embeddings' ? provider.embedding_models : provider.chat_models
}

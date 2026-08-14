import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, KeyRound, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { useTranslation } from '@/i18n'
import {
  getProviders,
  listCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
  testCredential,
  withCurrentModel,
  startTokenFlow,
  getTokenFlow,
  submitTokenFlowCode,
  type AuthMode,
  type Provider,
  type Credential,
  type TokenFlow,
} from '@/lib/llm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TableEmptyState } from '@/components/ui/table-empty-state'

/** Sentinel for "no default model" — Radix Select can't hold an empty value. */
const NO_MODEL = '__none__'

interface EditState {
  id: number | null // null = creating
  provider: string
  auth_mode: AuthMode
  label: string
  base_url: string
  default_model: string
  api_key: string
}

export default function LlmCredentialsTab() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<Provider[]>([])
  const [creds, setCreds] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; error: string | null }>>({})
  const [testingId, setTestingId] = useState<number | null>(null)
  // Browser sign-in for a subscription token (see the runner's token_flow_loop).
  const [flow, setFlow] = useState<TokenFlow | null>(null)
  const [flowBusy, setFlowBusy] = useState(false)
  const [browserCode, setBrowserCode] = useState('')
  // Escape hatch: paste a token minted elsewhere (`claude setup-token` in a
  // terminal) instead of signing in through the browser. One or the other —
  // showing both at once just looks like two fields for the same secret.
  const [manualToken, setManualToken] = useState(false)

  async function reload() {
    const [p, c] = await Promise.all([getProviders(), listCredentials()])
    setProviders(p.providers)
    setCreds(c)
  }

  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : t('llm.loadFailed')))
      .finally(() => setLoading(false))
  }, [t])

  const provider = useMemo(
    () => providers.find((p) => p.key === edit?.provider),
    [providers, edit?.provider],
  )
  // Every model the selected provider offers, plus the saved one if it predates
  // the catalog — so editing an old connection can't silently drop its model.
  const modelOptions = useMemo(() => {
    const catalog = provider
      ? [...provider.chat_models, ...provider.embedding_models, ...(provider.coding_models ?? [])]
      : []
    return withCurrentModel([...new Set(catalog)], edit?.default_model ?? '')
  }, [provider, edit?.default_model])

  const resetFlow = useCallback(() => {
    setFlow(null)
    setBrowserCode('')
    setManualToken(false)
  }, [])

  // The runner drives the CLI out of band, so the two waiting states are polled.
  const flowId = flow?.id
  const flowState = flow?.state
  useEffect(() => {
    if (flowId === undefined) return
    if (flowState !== 'requested' && flowState !== 'code_submitted') return
    const timer = window.setInterval(() => {
      getTokenFlow(flowId)
        .then(setFlow)
        .catch(() => {}) // a blip shouldn't abandon a sign-in — keep polling
    }, 2000)
    return () => window.clearInterval(timer)
  }, [flowId, flowState])

  async function onGenerateUrl() {
    setFlowBusy(true)
    setError(null)
    try {
      setFlow(await startTokenFlow())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('llm.signInFailed'))
    } finally {
      setFlowBusy(false)
    }
  }

  async function onSubmitCode() {
    if (!flow) return
    setFlowBusy(true)
    setError(null)
    try {
      setFlow(await submitTokenFlowCode(flow.id, browserCode.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('llm.signInFailed'))
    } finally {
      setFlowBusy(false)
    }
  }

  function startCreate() {
    resetFlow()
    const first = providers[0]
    setEdit({
      id: null,
      provider: first?.key ?? 'openai',
      auth_mode: first?.auth_modes[0] ?? 'api_key',
      label: '',
      base_url: '',
      default_model: '',
      api_key: '',
    })
  }

  function startEdit(c: Credential) {
    resetFlow()
    setEdit({
      id: c.id,
      provider: c.provider,
      auth_mode: c.auth_mode,
      label: c.label,
      base_url: c.base_url ?? '',
      default_model: c.default_model ?? '',
      api_key: '',
    })
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!edit) return
    setSaving(true)
    setError(null)
    try {
      // A finished browser sign-in supplies the secret server-side; otherwise
      // it's whatever was pasted into the key field.
      const signedIn = flow?.state === 'done' ? { token_flow_id: flow.id } : {}
      const typedKey = edit.api_key.trim() ? { api_key: edit.api_key } : {}
      if (edit.id === null) {
        await createCredential({
          provider: edit.provider,
          auth_mode: edit.auth_mode,
          label: edit.label.trim(),
          base_url: edit.base_url.trim() || null,
          default_model: edit.default_model.trim() || null,
          ...typedKey,
          ...signedIn,
        })
      } else {
        await updateCredential(edit.id, {
          label: edit.label.trim(),
          base_url: edit.base_url.trim() || null,
          default_model: edit.default_model.trim() || null,
          // Only rotate the secret when a new one was supplied.
          ...typedKey,
          ...signedIn,
        })
      }
      resetFlow()
      setEdit(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('llm.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(c: Credential) {
    if (!window.confirm(t('llm.deleteConfirm', { label: c.label }))) return
    try {
      await deleteCredential(c.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('llm.saveFailed'))
    }
  }

  async function onTest(c: Credential) {
    setTestingId(c.id)
    try {
      const r = await testCredential(c.id)
      setTestResult((prev) => ({ ...prev, [c.id]: r }))
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [c.id]: { ok: false, error: err instanceof Error ? err.message : 'error' },
      }))
    } finally {
      setTestingId(null)
    }
  }

  const providerLabel = (key: string) => providers.find((p) => p.key === key)?.label ?? key

  /** The paste-a-secret field. One definition, rendered either standalone (API
   *  key mode) or inside the sign-in panel as its manual alternative. */
  function secretField() {
    if (!edit) return null
    const subscription = edit.auth_mode === 'subscription'
    return (
      <div className="space-y-2">
        <Label htmlFor="llm-key">{t(subscription ? 'llm.token' : 'llm.apiKey')}</Label>
        <Input
          id="llm-key"
          type="password"
          autoComplete="off"
          value={edit.api_key}
          placeholder={
            edit.id !== null
              ? t('llm.apiKeyKeep')
              : t(subscription ? 'llm.tokenPlaceholder' : 'llm.apiKeyPlaceholder')
          }
          onChange={(e) => setEdit({ ...edit, api_key: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('llm.apiKeyHint')}</p>
      </div>
    )
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t('llm.subtitle')}</p>
        <Button type="button" size="sm" onClick={startCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {t('llm.addConnection')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {creds.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <tbody>
                <TableEmptyState
                  colSpan={1}
                  icon={KeyRound}
                  title={t('llm.emptyTitle')}
                  description={t('llm.emptyDesc')}
                />
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {creds.map((c) => {
            const r = testResult[c.id]
            return (
              <Card key={c.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.label}</span>
                      <Badge variant="secondary">{providerLabel(c.provider)}</Badge>
                      {c.auth_mode === 'subscription' && (
                        <Badge variant="outline">{t('llm.authSubscription')}</Badge>
                      )}
                      {c.has_key ? (
                        <Badge variant="outline" className="text-green-600 dark:text-green-500">
                          {t('llm.keySet')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t('llm.keyUnset')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.default_model || t('llm.noDefaultModel')}
                      {c.base_url ? ` · ${c.base_url}` : ''}
                    </p>
                    {r && (
                      <p
                        className={`flex items-center gap-1 text-xs ${
                          r.ok ? 'text-green-600 dark:text-green-500' : 'text-destructive'
                        }`}
                      >
                        {r.ok ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {r.ok ? t('llm.testOk') : (r.error ?? t('llm.testFail'))}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={testingId === c.id}
                      onClick={() => onTest(c)}
                    >
                      {testingId === c.id ? t('llm.testing') : t('llm.test')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(c)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.delete')}
                      onClick={() => onDelete(c)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog
        open={!!edit}
        onOpenChange={(o) => {
          if (!o) {
            resetFlow()
            setEdit(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {edit?.id === null ? t('llm.addConnection') : t('llm.editConnection')}
            </DialogTitle>
            <DialogDescription>{t('llm.dialogDesc')}</DialogDescription>
          </DialogHeader>
          {edit && (
            <form onSubmit={onSave} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('llm.provider')}</Label>
                  <Select
                    value={edit.provider}
                    onValueChange={(v) =>
                      setEdit({
                        ...edit,
                        provider: v,
                        // Auth modes and models are provider-specific — reset both.
                        auth_mode: providers.find((p) => p.key === v)?.auth_modes[0] ?? 'api_key',
                        default_model: '',
                      })
                    }
                    disabled={edit.id !== null}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-label">{t('llm.label')}</Label>
                  <Input
                    id="llm-label"
                    value={edit.label}
                    placeholder={t('llm.labelPlaceholder')}
                    onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('llm.authMode')}</Label>
                <Select
                  value={edit.auth_mode}
                  onValueChange={(v) => setEdit({ ...edit, auth_mode: v as AuthMode })}
                  // The secret shape differs per mode, so it's fixed after creation.
                  disabled={edit.id !== null || (provider?.auth_modes.length ?? 1) < 2}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(provider?.auth_modes ?? ['api_key']).map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(m === 'subscription' ? 'llm.authSubscription' : 'llm.authApiKey')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t(
                    edit.auth_mode === 'subscription'
                      ? 'llm.authSubscriptionHint'
                      : 'llm.authApiKeyHint',
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="llm-model">{t('llm.defaultModel')}</Label>
                <Select
                  value={edit.default_model || NO_MODEL}
                  onValueChange={(v) =>
                    setEdit({ ...edit, default_model: v === NO_MODEL ? '' : v })
                  }
                >
                  <SelectTrigger id="llm-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_MODEL}>{t('llm.noDefaultModel')}</SelectItem>
                    {modelOptions.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {provider?.supports_base_url && (
                <div className="space-y-2">
                  <Label htmlFor="llm-base-url">{t('llm.baseUrl')}</Label>
                  <Input
                    id="llm-base-url"
                    value={edit.base_url}
                    placeholder="https://api.openai.com/v1"
                    onChange={(e) => setEdit({ ...edit, base_url: e.target.value })}
                  />
                </div>
              )}
              {edit.auth_mode === 'subscription' ? (
                <div className="space-y-3 rounded-md border bg-muted/40 p-3">
                  <p className="text-sm font-medium leading-none">{t('llm.signIn')}</p>
                  {manualToken ? (
                    <div className="space-y-3">
                      {secretField()}
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => setManualToken(false)}
                      >
                        {t('llm.useSignIn')}
                      </Button>
                    </div>
                  ) : (
                    <>
                  {!flow && (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={flowBusy}
                        onClick={onGenerateUrl}
                      >
                        {flowBusy ? t('llm.generatingUrl') : t('llm.generateUrl')}
                      </Button>
                      <p className="text-xs text-muted-foreground">{t('llm.signInHint')}</p>
                    </div>
                  )}
                  {flow?.state === 'requested' && (
                    <p className="text-sm text-muted-foreground">{t('llm.generatingUrl')}</p>
                  )}
                  {flow?.url && (flow.state === 'awaiting_code' || flow.state === 'code_submitted') && (
                    // A button, not a link: on the brand palette, link-coloured text
                    // is pale against the panel — the filled variant pairs the same
                    // green with dark text, which is what the dialog's other actions use.
                    <Button asChild size="sm" className="w-full sm:w-auto">
                      <a href={flow.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        {t('llm.openSignIn')}
                      </a>
                    </Button>
                  )}
                  {flow?.state === 'awaiting_code' && (
                    <div className="space-y-2">
                      <Label htmlFor="llm-code">{t('llm.browserCode')}</Label>
                      <div className="flex gap-2">
                        <Input
                          id="llm-code"
                          autoComplete="off"
                          value={browserCode}
                          placeholder={t('llm.browserCodePlaceholder')}
                          onChange={(e) => setBrowserCode(e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={flowBusy || !browserCode.trim()}
                          onClick={onSubmitCode}
                        >
                          {t('llm.submitCode')}
                        </Button>
                      </div>
                    </div>
                  )}
                  {flow?.state === 'code_submitted' && (
                    <p className="text-sm text-muted-foreground">{t('llm.exchanging')}</p>
                  )}
                  {flow?.state === 'done' && (
                    <p className="flex items-center gap-1 text-sm text-green-600 dark:text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      {t('llm.tokenReady')}
                    </p>
                  )}
                  {flow?.state === 'failed' && (
                    <div className="space-y-2">
                      <p className="text-sm text-destructive">
                        {flow.error ?? t('llm.signInFailed')}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={flowBusy}
                        // Straight to a fresh URL — resetting to the initial
                        // button would make this two clicks of the same label.
                        onClick={() => {
                          setBrowserCode('')
                          void onGenerateUrl()
                        }}
                      >
                        {flowBusy ? t('llm.generatingUrl') : t('llm.generateUrl')}
                      </Button>
                    </div>
                  )}
                  {!flow && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => setManualToken(true)}
                    >
                      {t('llm.pasteInstead')}
                    </Button>
                  )}
                    </>
                  )}
                </div>
              ) : (
                secretField()
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    resetFlow()
                    setEdit(null)
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saving ||
                    !edit.label.trim() ||
                    // A new connection needs a secret from one source or the other.
                    (edit.id === null && !edit.api_key.trim() && flow?.state !== 'done')
                  }
                >
                  {saving ? t('common.saving') : t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

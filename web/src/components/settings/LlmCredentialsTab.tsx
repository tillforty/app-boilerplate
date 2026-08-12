import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, KeyRound, CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from '@/i18n'
import {
  getProviders,
  listCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
  testCredential,
  type Provider,
  type Credential,
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

interface EditState {
  id: number | null // null = creating
  provider: string
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
  // Chat + embedding models offered by the selected provider (for the datalist).
  const modelOptions = useMemo(
    () => (provider ? [...provider.chat_models, ...provider.embedding_models] : []),
    [provider],
  )

  function startCreate() {
    const first = providers[0]
    setEdit({
      id: null,
      provider: first?.key ?? 'openai',
      label: '',
      base_url: '',
      default_model: '',
      api_key: '',
    })
  }

  function startEdit(c: Credential) {
    setEdit({
      id: c.id,
      provider: c.provider,
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
      if (edit.id === null) {
        await createCredential({
          provider: edit.provider,
          label: edit.label.trim(),
          base_url: edit.base_url.trim() || null,
          default_model: edit.default_model.trim() || null,
          api_key: edit.api_key,
        })
      } else {
        await updateCredential(edit.id, {
          label: edit.label.trim(),
          base_url: edit.base_url.trim() || null,
          default_model: edit.default_model.trim() || null,
          // Only send api_key when the admin typed a new one.
          ...(edit.api_key.trim() ? { api_key: edit.api_key } : {}),
        })
      }
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

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
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
                    onValueChange={(v) => setEdit({ ...edit, provider: v, default_model: '' })}
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
                <Label htmlFor="llm-model">{t('llm.defaultModel')}</Label>
                <Input
                  id="llm-model"
                  list="llm-model-options"
                  value={edit.default_model}
                  placeholder={t('llm.modelPlaceholder')}
                  onChange={(e) => setEdit({ ...edit, default_model: e.target.value })}
                />
                <datalist id="llm-model-options">
                  {modelOptions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
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
              <div className="space-y-2">
                <Label htmlFor="llm-key">{t('llm.apiKey')}</Label>
                <Input
                  id="llm-key"
                  type="password"
                  autoComplete="off"
                  value={edit.api_key}
                  placeholder={edit.id === null ? t('llm.apiKeyPlaceholder') : t('llm.apiKeyKeep')}
                  onChange={(e) => setEdit({ ...edit, api_key: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('llm.apiKeyHint')}</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEdit(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saving ||
                    !edit.label.trim() ||
                    (edit.id === null && !edit.api_key.trim())
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

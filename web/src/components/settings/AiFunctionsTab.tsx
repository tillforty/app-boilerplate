import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from '@/i18n'
import {
  getProviders,
  listCredentials,
  listFunctions,
  setFunctionBinding,
  modelsFor,
  type Provider,
  type Credential,
  type FunctionBinding,
} from '@/lib/llm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const NONE = '__none__'

interface Draft {
  credential_id: number | null
  model: string
}

export default function AiFunctionsTab() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<Provider[]>([])
  const [creds, setCreds] = useState<Credential[]>([])
  const [functions, setFunctions] = useState<FunctionBinding[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getProviders(), listCredentials(), listFunctions()])
      .then(([p, c, f]) => {
        setProviders(p.providers)
        setCreds(c)
        setFunctions(f)
        setDrafts(
          Object.fromEntries(
            f.map((fn) => [fn.key, { credential_id: fn.credential_id, model: fn.model ?? '' }]),
          ),
        )
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('llm.loadFailed')))
      .finally(() => setLoading(false))
  }, [t])

  const providerByKey = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.key, p])),
    [providers],
  )

  // Credentials eligible for a capability = those whose provider supports it.
  function eligibleCreds(capability: FunctionBinding['capability']): Credential[] {
    return creds.filter((c) => providerByKey[c.provider]?.capabilities.includes(capability))
  }

  function modelOptionsFor(fn: FunctionBinding, credId: number | null): string[] {
    const cred = creds.find((c) => c.id === credId)
    return modelsFor(cred ? providerByKey[cred.provider] : undefined, fn.capability)
  }

  async function onSave(fn: FunctionBinding) {
    const draft = drafts[fn.key]
    setSavingKey(fn.key)
    setError(null)
    try {
      const updated = await setFunctionBinding(fn.key, {
        credential_id: draft.credential_id,
        model: draft.model.trim() || null,
      })
      setFunctions((prev) => prev.map((f) => (f.key === fn.key ? updated : f)))
      setSavedKey(fn.key)
      setTimeout(() => setSavedKey((k) => (k === fn.key ? null : k)), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('llm.saveFailed'))
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('llm.functionsSubtitle')}</p>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {creds.length === 0 && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm">
          {t('llm.functionsNoCreds')}
        </div>
      )}

      {functions.map((fn) => {
        const draft = drafts[fn.key] ?? { credential_id: null, model: '' }
        const options = eligibleCreds(fn.capability)
        const models = modelOptionsFor(fn, draft.credential_id)
        return (
          <Card key={fn.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {fn.label}
                <Badge variant="secondary">{fn.capability}</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{fn.description}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('llm.connection')}</Label>
                  <Select
                    value={draft.credential_id === null ? NONE : String(draft.credential_id)}
                    onValueChange={(v) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [fn.key]: {
                          credential_id: v === NONE ? null : Number(v),
                          model: '',
                        },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('llm.connectionNone')}</SelectItem>
                      {options.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.label} ({providerByKey[c.provider]?.label ?? c.provider})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {options.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('llm.noEligibleCreds', { capability: fn.capability })}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`model-${fn.key}`}>{t('llm.model')}</Label>
                  <Input
                    id={`model-${fn.key}`}
                    list={`models-${fn.key}`}
                    value={draft.model}
                    disabled={draft.credential_id === null}
                    placeholder={t('llm.modelDefaultPlaceholder')}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [fn.key]: { ...draft, model: e.target.value },
                      }))
                    }
                  />
                  <datalist id={`models-${fn.key}`}>
                    {models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  disabled={savingKey === fn.key}
                  onClick={() => onSave(fn)}
                >
                  {savingKey === fn.key ? t('common.saving') : t('common.save')}
                </Button>
                {savedKey === fn.key && (
                  <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-500">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('llm.saved')}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

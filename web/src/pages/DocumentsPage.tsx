import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, MoreHorizontal, Plus, Trash2, FileText, Image, File } from 'lucide-react'
import {
  listFiles,
  uploadFile,
  downloadFile,
  deleteFileById,
  type FileRecord,
} from '@/lib/files'
import { formatDate } from '@/lib/format'
import { useTranslation } from '@/i18n'
import { useAppSettings } from '@/context/AppSettingsContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableEmptyState } from '@/components/ui/table-empty-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const TYPE_ICON: Record<FileRecord['type'], React.ElementType> = {
  document: FileText,
  image: Image,
  other: File,
}

function guessType(file: File): FileRecord['type'] {
  if (file.type.startsWith('image/')) return 'image'
  if (
    file.type === 'application/pdf' ||
    file.type.startsWith('text/') ||
    file.name.match(/\.(doc|docx|xls|xlsx|ppt|pptx|csv|txt|md)$/i)
  )
    return 'document'
  return 'other'
}

export default function DocumentsPage() {
  const { t } = useTranslation()
  const { settings } = useAppSettings()
  const [rows, setRows] = useState<FileRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // download state — track which ids are in-flight
  const [downloading, setDownloading] = useState<Set<number>>(new Set())

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<FileRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await listFiles())
    } catch {
      setError(t('documents.loadFailed'))
    }
  }, [t])

  useEffect(() => { load() }, [load])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const record = await uploadFile(file, guessType(file))
      setRows((prev) => (prev ? [record, ...prev] : [record]))
    } catch {
      setError(t('documents.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(doc: FileRecord) {
    setDownloading((s) => new Set(s).add(doc.id))
    try {
      await downloadFile(doc.id, doc.name)
    } catch {
      setError(t('documents.downloadFailed'))
    } finally {
      setDownloading((s) => { const n = new Set(s); n.delete(doc.id); return n })
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteFileById(deleteTarget.id)
      setRows((prev) => (prev ?? []).filter((r) => r.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch {
      setError(t('documents.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  const loading = rows === null

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('documents.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('documents.description', {
              storage:
                import.meta.env.VITE_STORAGE_TYPE === 'backblaze'
                  ? 'Backblaze B2'
                  : t('documents.storageLocal'),
            })}
          </p>
        </div>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          {uploading ? t('documents.uploading') : t('documents.upload')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('documents.colName')}</TableHead>
              <TableHead>{t('documents.colType')}</TableHead>
              <TableHead>{t('documents.colUploaded')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-4 rounded" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableEmptyState
                colSpan={4}
                icon={FileText}
                title={t('documents.emptyTitle')}
                description={t('documents.emptyDesc')}
              />
            ) : (
              rows.map((doc) => {
                const Icon = TYPE_ICON[doc.type]
                return (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{doc.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t(`documents.type.${doc.type}`)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(doc.created_at, settings?.timezone)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">{t('common.openMenu')}</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleDownload(doc)}
                            disabled={downloading.has(doc.id)}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            {downloading.has(doc.id) ? t('documents.downloading') : t('documents.download')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(doc)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('common.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rows.length === 1
            ? t('documents.fileCountOne', { count: rows.length })
            : t('documents.fileCountOther', { count: rows.length })}
        </p>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('documents.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('documents.deleteConfirmLead')}{' '}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>
              {t('documents.deleteConfirmTail')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? t('common.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

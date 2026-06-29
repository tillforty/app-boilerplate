import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, MoreHorizontal, Plus, Trash2, FileText, Image, File } from 'lucide-react'
import {
  listFiles,
  uploadFile,
  downloadFile,
  deleteFileById,
  type FileRecord,
} from '@/lib/files'
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

const TYPE_LABEL: Record<FileRecord['type'], string> = {
  document: 'Document',
  image: 'Image',
  other: 'Other',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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
      setError('Failed to load documents.')
    }
  }, [])

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
      setError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(doc: FileRecord) {
    setDownloading((s) => new Set(s).add(doc.id))
    try {
      await downloadFile(doc.id, doc.name)
    } catch {
      setError('Download failed.')
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
      setError('Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  const loading = rows === null

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Upload, download, and manage files stored in{' '}
            {import.meta.env.VITE_STORAGE_TYPE === 'backblaze' ? 'Backblaze B2' : 'local storage'}.
          </p>
        </div>
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload file'}
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
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Uploaded</TableHead>
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
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                  No documents yet. Upload your first file.
                </TableCell>
              </TableRow>
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
                      <Badge variant="secondary">{TYPE_LABEL[doc.type]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(doc.created_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleDownload(doc)}
                            disabled={downloading.has(doc.id)}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            {downloading.has(doc.id) ? 'Downloading…' : 'Download'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(doc)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
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
        <p className="text-xs text-muted-foreground">{rows.length} file{rows.length !== 1 ? 's' : ''}</p>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              Permanently delete{' '}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>? This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

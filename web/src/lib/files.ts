import { api, apiUpload, apiBlob } from './api'

export interface FileRecord {
  id: number
  name: string
  type: 'document' | 'image' | 'other'
  storage_path: string
  created_at: string
}

export function listFiles(): Promise<FileRecord[]> {
  return api.get<FileRecord[]>('/files')
}

export function uploadFile(file: File, type: FileRecord['type'] = 'other'): Promise<FileRecord> {
  const form = new FormData()
  form.append('file', file)
  form.append('type', type)
  return apiUpload<FileRecord>('/files', form)
}

export async function downloadFile(id: number, name: string): Promise<void> {
  const blob = await apiBlob(`/files/${id}/content`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function deleteFileById(id: number): Promise<void> {
  return api.delete<void>(`/files/${id}`)
}

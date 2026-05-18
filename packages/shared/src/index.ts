export interface PdfJob {
  id: string
  html: string
  title?: string
  template?: string
  format?: string
  margin?: { top: string; right: string; bottom: string; left: string }
}

export interface PdfJobResult {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  url?: string
  error?: string
  createdAt: number
  completedAt?: number
}

export interface TemplateData {
  title: string
  messages: Message[]
}

export interface Message {
  role: string
  content: string
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found: ${jobId}`)
    this.name = 'JobNotFoundError'
  }
}

export function buildDownloadName(title?: string): string {
  if (!title) return 'document.pdf'
  const sanitized = title.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim()
  return `${sanitized || 'document'}.pdf`
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

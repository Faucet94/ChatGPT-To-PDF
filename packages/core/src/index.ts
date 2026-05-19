import { z } from 'zod'
import { ValidationError, PdfJob, generateId } from '@html-to-pdf/shared'

const generatePayloadSchema = z.object({
  html: z.string().min(1),
  title: z.string().optional(),
  template: z.string().optional(),
  format: z.string().optional().default('A4'),
  margin: z
    .object({
      top: z.string().optional(),
      right: z.string().optional(),
      bottom: z.string().optional(),
      left: z.string().optional(),
    })
    .optional(),
})

const legacyGeneratePayloadSchema = z.object({
  data: z.object({
    title: z.string().optional(),
    messages: z
      .array(z.object({
        role: z.string().optional(),
        html: z.string().optional(),
        content: z.string().optional(),
      }))
      .min(1),
  }),
})

export function validateAndNormalize(payload: unknown): PdfJob {
  const normalizedPayload = normalizePayload(payload)
  const result = generatePayloadSchema.safeParse(normalizedPayload)
  if (!result.success) {
    throw new ValidationError(
      result.error.errors
        .map(e => `${e.path.join('.') || 'payload'}: ${e.message}`)
        .join(', '),
    )
  }
  return {
    id: generateId(),
    html: result.data.html,
    title: result.data.title,
    template: result.data.template,
    format: result.data.format,
    margin: {
      top: result.data.margin?.top ?? '20mm',
      right: result.data.margin?.right ?? '15mm',
      bottom: result.data.margin?.bottom ?? '20mm',
      left: result.data.margin?.left ?? '15mm',
    },
  }
}

function normalizePayload(payload: unknown): unknown {
  const result = legacyGeneratePayloadSchema.safeParse(payload)
  if (!result.success) return payload

  return {
    title: result.data.data.title,
    html: renderLegacyMessages(result.data.data.messages),
    format: 'A4',
  }
}

function renderLegacyMessages(messages: Array<{ role?: string; html?: string; content?: string }>): string {
  const body = messages
    .map((message, index) => {
      const role = escapeHtml(message.role || 'content')
      const html = message.html || escapeHtml(message.content || '')
      return `<section class="message message-${role}">
        <header>#${index + 1} ${role}</header>
        <div>${html}</div>
      </section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; padding: 24px; font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111827; line-height: 1.55; }
      .message { break-inside: avoid; margin: 0 0 16px; padding: 14px 16px; border: 1px solid #e5e7eb; border-radius: 10px; }
      .message header { margin-bottom: 10px; color: #64748b; font-size: 12px; font-weight: 700; text-transform: uppercase; }
      img, svg, canvas, video { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; }
      table { width: 100%; border-collapse: collapse; }
      td, th { border: 1px solid #e5e7eb; padding: 6px 8px; }
    </style>
  </head>
  <body>${body}</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

export function validateAndNormalize(payload: unknown): PdfJob {
  const result = generatePayloadSchema.safeParse(payload)
  if (!result.success) {
    throw new ValidationError(result.error.errors.map(e => e.message).join(', '))
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

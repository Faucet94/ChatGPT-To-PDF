import { createRedisClient, createWorker } from '@html-to-pdf/queue'
import { renderPDF } from '@html-to-pdf/renderer'
import { renderTemplate } from '@html-to-pdf/templates'
import { S3StorageAdapter } from '@html-to-pdf/storage'
import { PdfJob, buildDownloadName } from '@html-to-pdf/shared'

const redis = createRedisClient()
const storage = new S3StorageAdapter()

async function updateJobStatus(jobId: string, status: string, url?: string, error?: string) {
  await redis.set(
    `job:${jobId}`,
    JSON.stringify({ jobId, status, url, error, updatedAt: Date.now() }),
  )
}

async function processJob(job: PdfJob) {
  await updateJobStatus(job.id, 'processing')
  try {
    let html = job.html
    if (job.template === 'chatgpt' && job.title) {
      html = renderTemplate('chatgpt', { title: job.title, messages: job.html })
    }
    const pdfBuffer = await renderPDF(html, {
      format: job.format,
      margin: job.margin,
    })
    const key = buildDownloadName(job.title)
    const url = await storage.upload(pdfBuffer, key)
    await updateJobStatus(job.id, 'completed', url)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await updateJobStatus(job.id, 'failed', undefined, message)
    throw err
  }
}

const worker = createWorker(processJob)

process.on('SIGTERM', async () => {
  await worker.close()
  await redis.quit()
  process.exit(0)
})

console.log('Worker started')

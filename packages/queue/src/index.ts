import { Queue, Worker, Job } from 'bullmq'
import { PdfJob } from '@html-to-pdf/shared'

const QUEUE_NAME = 'pdf-job'

function getRedisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379'
}

export function createQueue(): Queue {
  return new Queue(QUEUE_NAME, {
    connection: { url: getRedisUrl() },
  })
}

export function createWorker(
  processor: (job: PdfJob) => Promise<void>,
  concurrency: number = 2,
): Worker {
  return new Worker(QUEUE_NAME, async (job: Job) => {
    await processor(job.data as PdfJob)
  }, {
    connection: { url: getRedisUrl() },
    concurrency,
  })
}

import { Queue, Worker, Job } from 'bullmq'
import { PdfJob } from '@html-to-pdf/shared'
import Redis, { RedisOptions } from 'ioredis'

const QUEUE_NAME = 'pdf-job'

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379'
}

function getRedisTlsOptions(url: string): RedisOptions {
  const useTLS = url.startsWith('rediss://') || process.env.REDIS_TLS === 'true'
  return useTLS ? { tls: { rejectUnauthorized: false } } : {}
}

export function getRedisConnection(): RedisOptions & { url: string } {
  const url = getRedisUrl()
  return {
    url,
    ...getRedisTlsOptions(url),
  }
}

export function createRedisClient(options: RedisOptions = {}): Redis {
  const url = getRedisUrl()
  const redis = new Redis(url, {
    ...getRedisTlsOptions(url),
    ...options,
  })

  redis.on('error', (err) => {
    console.error(`Redis connection error: ${err.message}`)
  })

  return redis
}

export function createQueue(): Queue {
  return new Queue(QUEUE_NAME, {
    connection: getRedisConnection(),
  })
}

export function createWorker(
  processor: (job: PdfJob) => Promise<void>,
  concurrency: number = 2,
): Worker {
  return new Worker(QUEUE_NAME, async (job: Job) => {
    await processor(job.data as PdfJob)
  }, {
    connection: getRedisConnection(),
    concurrency,
  })
}

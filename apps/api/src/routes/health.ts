import { FastifyReply, FastifyRequest } from 'fastify'
import Redis from 'ioredis'
import { hostname } from 'os'

const startTime = Date.now()
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
      ...(process.env.REDIS_URL?.startsWith('rediss://')
        ? { tls: { rejectUnauthorized: false } }
        : {}),
    })
  : null

let lastMetrics: Record<string, number> = {}

export function updateMetrics(delta: Partial<Record<string, number>>) {
  for (const [key, val] of Object.entries(delta)) {
    lastMetrics[key] = (lastMetrics[key] || 0) + (val || 0)
  }
}

export async function healthRoute(_request: FastifyRequest, reply: FastifyReply) {
  let redisStatus = 'unknown'
  if (redis) {
    try {
      await redis.ping()
      redisStatus = 'connected'
    } catch {
      redisStatus = 'disconnected'
    }
  } else {
    redisStatus = 'not configured'
  }

  return reply.status(200).send({
    status: 'ok',
    version: '1.0.0',
    hostname: hostname(),
    environment: process.env.NODE_ENV || 'production',
    uptime: {
      seconds: Math.floor((Date.now() - startTime) / 1000),
      formatted: formatUptime(Math.floor((Date.now() - startTime) / 1000)),
    },
    metrics: {
      total: lastMetrics.total || 0,
      completed: lastMetrics.completed || 0,
      pending: lastMetrics.pending || 0,
      failed: lastMetrics.failed || 0,
    },
    redis: redisStatus,
    timestamp: Date.now(),
  })
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (mins > 0) parts.push(`${mins}m`)
  parts.push(`${secs}s`)
  return parts.join(' ')
}
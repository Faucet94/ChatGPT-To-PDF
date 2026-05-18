import { FastifyReply, FastifyRequest } from 'fastify'
import { JobNotFoundError } from '@html-to-pdf/shared'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  ...(process.env.REDIS_URL?.startsWith('rediss://')
    ? { tls: { rejectUnauthorized: false } }
    : {}),
})

export async function statusRoute(request: FastifyRequest, reply: FastifyReply) {
  const { jobId } = request.params as { jobId: string }
  const data = await redis.get(`job:${jobId}`)
  if (!data) {
    return reply.status(404).send({ error: `Job not found: ${jobId}` })
  }
  return reply.send(JSON.parse(data))
}

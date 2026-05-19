import { FastifyReply, FastifyRequest } from 'fastify'
import { JobNotFoundError } from '@html-to-pdf/shared'
import { createRedisClient } from '@html-to-pdf/queue'

const redis = createRedisClient()

export async function statusRoute(request: FastifyRequest, reply: FastifyReply) {
  const { jobId } = request.params as { jobId: string }
  const data = await redis.get(`job:${jobId}`)
  if (!data) {
    return reply.status(404).send({ error: `Job not found: ${jobId}` })
  }
  return reply.send(JSON.parse(data))
}

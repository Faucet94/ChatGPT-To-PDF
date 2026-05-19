import { FastifyReply, FastifyRequest } from 'fastify'
import { validateAndNormalize } from '@html-to-pdf/core'
import { ValidationError } from '@html-to-pdf/shared'
import { createQueue, createRedisClient } from '@html-to-pdf/queue'

export async function generateRoute(request: FastifyRequest, reply: FastifyReply) {
  try {
    const job = validateAndNormalize(request.body)
    const queue = createQueue()
    const redis = createRedisClient()
    await redis.set(
      `job:${job.id}`,
      JSON.stringify({ jobId: job.id, status: 'pending', createdAt: Date.now(), updatedAt: Date.now() }),
    )
    await queue.add(job.id, job, {
      jobId: job.id,
    })
    await queue.close()
    await redis.quit()
    return reply.status(202).send({ jobId: job.id, status: 'pending' })
  } catch (err) {
    if (err instanceof ValidationError) {
      return reply.status(400).send({ error: err.message })
    }
    throw err
  }
}

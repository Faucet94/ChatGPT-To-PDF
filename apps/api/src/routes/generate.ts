import { FastifyReply, FastifyRequest } from 'fastify'
import { validateAndNormalize } from '@html-to-pdf/core'
import { ValidationError } from '@html-to-pdf/shared'
import { createQueue } from '@html-to-pdf/queue'

export async function generateRoute(request: FastifyRequest, reply: FastifyReply) {
  try {
    const job = validateAndNormalize(request.body)
    const queue = createQueue()
    await queue.add(job.id, job, {
      jobId: job.id,
    })
    await queue.close()
    return reply.status(202).send({ jobId: job.id, status: 'pending' })
  } catch (err) {
    if (err instanceof ValidationError) {
      return reply.status(400).send({ error: err.message })
    }
    throw err
  }
}

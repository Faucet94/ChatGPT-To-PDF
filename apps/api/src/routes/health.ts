import { FastifyReply, FastifyRequest } from 'fastify'

export async function healthRoute(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ status: 'ok', timestamp: Date.now() })
}

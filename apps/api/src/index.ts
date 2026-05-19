import Fastify, { FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import formbody from '@fastify/formbody'
import { healthRoute } from './routes/health'
import { generateRoute } from './routes/generate'
import { statusRoute } from './routes/status'
import { adminRoute, adminOverviewApi, adminJobsApi, adminRedisApi, adminLogsApi, loginPageRoute, loginApiRoute, verifyTokenRoute } from './routes/admin'

const server = Fastify({
  logger: true,
})

function getAdminApiPrefix(): string {
  const value = process.env.ADMIN_API_PREFIX || '/admin/_session'
  return value.startsWith('/') ? value : `/${value}`
}

server.register(cors, {
  origin: true,
})
server.register(formbody)

server.addContentTypeParser('text/plain', { parseAs: 'string' }, async (_request: FastifyRequest, body: string) => {
  const text = String(body)
  try {
    return JSON.parse(text)
  } catch {
    return { html: text }
  }
})

server.addContentTypeParser('text/html', { parseAs: 'string' }, async (_request: FastifyRequest, body: string) => {
  return { html: String(body) }
})

server.get('/', async () => ({ service: 'html-to-pdf-engine', version: '1.0.0' }))
server.get('/health', healthRoute)
server.post('/generate', generateRoute)
server.get('/status/:jobId', statusRoute)

// Admin routes
const adminApiPrefix = getAdminApiPrefix()
server.get('/admin', adminRoute)
server.get('/admin/login', loginPageRoute)
server.post('/admin/login', loginApiRoute)
server.post('/admin/verify', verifyTokenRoute)
server.get(`${adminApiPrefix}/overview`, adminOverviewApi)
server.get(`${adminApiPrefix}/jobs`, adminJobsApi)
server.get(`${adminApiPrefix}/redis`, adminRedisApi)
server.get(`${adminApiPrefix}/logs`, adminLogsApi)

const port = parseInt(process.env.PORT ?? '3014')
server.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
  server.log.info(`Server running on port ${port}`)
})

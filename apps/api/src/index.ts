import Fastify from 'fastify'
import cors from '@fastify/cors'
import { healthRoute } from './routes/health'
import { generateRoute } from './routes/generate'
import { statusRoute } from './routes/status'

const server = Fastify({
  logger: true,
})

server.register(cors, {
  origin: true,
})

server.get('/', async () => ({ service: 'html-to-pdf-engine', version: '1.0.0' }))
server.get('/health', healthRoute)
server.post('/generate', generateRoute)
server.get('/status/:jobId', statusRoute)

const port = parseInt(process.env.PORT ?? '3014')
server.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
  server.log.info(`Server running on port ${port}`)
})

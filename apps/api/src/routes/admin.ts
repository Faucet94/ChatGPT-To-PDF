import { FastifyReply, FastifyRequest } from 'fastify'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import Redis from 'ioredis'
import { createHash, randomBytes } from 'crypto'

const startTime = Date.now()

// ── Credenciais do Admin ────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'AdminMaster@2026!'
const ADMIN_PASS = process.env.ADMIN_PASS || 'S3nh@Sup3rF0rt3!@#2026'
const ADMIN_SECRET = process.env.ADMIN_SECRET || randomBytes(32).toString('hex')

// ── Proteção Anti-Fuzzing / Anti-Brute Force ────────────────
interface RateLimitEntry {
  count: number
  firstAttempt: number
  lastAttempt: number
  blockedUntil: number
  honeypotFailed: boolean
}

const rateLimitMap = new Map<string, RateLimitEntry>()
const RATE_LIMIT_MAX_ATTEMPTS = 5
const RATE_LIMIT_WINDOW = 15 * 60 * 1000
const RATE_LIMIT_BLOCK_DURATION = 30 * 60 * 1000
const RATE_LIMIT_HONEYPOT_BLOCK = 60 * 60 * 1000

const BLOCKED_USER_AGENTS = [
  'sqlmap', 'gobuster', 'dirbuster', 'nmap', 'nikto', 'wfuzz',
  'ffuf', 'zap', 'burp', 'acunetix', 'nessus', 'openvas',
  'python-requests', 'python-urllib', 'python-httpx', 'aiohttp',
  'curl', 'wget', 'libcurl', 'httpx', 'feroxbuster',
  'masscan', 'hydra', 'medusa', 'thc', 'patator',
  'go-http-client', 'Go-http-client', 'fasthttp',
  'zgrab', 'jael', 'jaeles',
]

const SUSPICIOUS_HEADERS = [
  'x-fuzz', 'x-scanner', 'x-attack', 'x-security',
  'x-probe', 'x-enum', 'x-brute', 'x-crawl',
  'fuzz', 'scan', 'attack', 'probe',
]

const MALICIOUS_PATTERNS = [
  /(\b(select|union|insert|delete|drop|alter|create|truncate|exec|declare|cast|convert)\b)/i,
  /(<script|javascript:|onerror=|onload=|alert\(|prompt\(|confirm\()/i,
  /(\.\.\/|\.\.\\|\.\.%2f|\.\.%5c|%00|%0d%0a)/i,
  /(\b(bash|cmd|powershell|sh\s|wget\s|curl\s|nc\s)\b)/i,
  /('|"|;|--|#|\/\*|\*\/)/,
]

const HONEYPOT_FIELD = 'website_url'

setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.blockedUntil && now - entry.firstAttempt > RATE_LIMIT_WINDOW * 2) {
      rateLimitMap.delete(ip)
    }
  }
}, 5 * 60 * 1000)

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  return request.ip || 'unknown'
}

function isBlockedUserAgent(request: FastifyRequest): boolean {
  const ua = (request.headers['user-agent'] || '').toLowerCase()
  return BLOCKED_USER_AGENTS.some(pattern => ua.includes(pattern.toLowerCase()))
}

function hasSuspiciousHeaders(request: FastifyRequest): boolean {
  for (const key of Object.keys(request.headers)) {
    const lower = key.toLowerCase()
    if (SUSPICIOUS_HEADERS.some(s => lower.includes(s.toLowerCase()))) return true
  }
  return false
}

function hasMaliciousPayload(value: string): boolean {
  return MALICIOUS_PATTERNS.some(pattern => pattern.test(value))
}

function isRateLimited(ip: string): { blocked: boolean; reason?: string; retryAfter?: number } {
  const entry = rateLimitMap.get(ip)
  if (!entry) return { blocked: false }
  const now = Date.now()
  if (now < entry.blockedUntil) {
    return {
      blocked: true,
      reason: entry.honeypotFailed ? 'Acesso bloqueado por atividade suspeita' : 'Muitas tentativas de login. Tente novamente mais tarde.',
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    }
  }
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW) {
    rateLimitMap.delete(ip)
    return { blocked: false }
  }
  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    entry.blockedUntil = now + RATE_LIMIT_BLOCK_DURATION
    return { blocked: true, reason: 'Muitas tentativas de login. Tente novamente em 30 minutos.', retryAfter: RATE_LIMIT_BLOCK_DURATION / 1000 }
  }
  return { blocked: false }
}

function recordAttempt(ip: string, failed: boolean, honeypotTriggered = false) {
  const now = Date.now()
  let entry = rateLimitMap.get(ip)
  if (!entry) {
    entry = { count: 0, firstAttempt: now, lastAttempt: now, blockedUntil: 0, honeypotFailed: false }
    rateLimitMap.set(ip, entry)
  }
  entry.lastAttempt = now
  if (failed) entry.count++
  if (honeypotTriggered) {
    entry.honeypotFailed = true
    entry.blockedUntil = now + RATE_LIMIT_HONEYPOT_BLOCK
  }
}

function getCalculatedDelay(ip: string): number {
  const entry = rateLimitMap.get(ip)
  if (!entry || entry.count === 0) return 0
  return Math.min(500 * Math.pow(2, entry.count - 1), 8000)
}

// ── Token Management ────────────────────────────────────────
const activeTokens = new Set<string>()
const tokenExpiry = new Map<string, number>()
const TOKEN_TTL = 24 * 60 * 60 * 1000

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
      ...(process.env.REDIS_URL?.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}),
    })
  : null

function hashToken(token: string): string {
  return createHash('sha256').update(token + ADMIN_SECRET).digest('hex')
}

function generateToken(): { token: string; expiresAt: number } {
  const raw = randomBytes(48).toString('hex')
  const token = hashToken(raw)
  const expiresAt = Date.now() + TOKEN_TTL
  activeTokens.add(token)
  tokenExpiry.set(token, expiresAt)
  setTimeout(() => { activeTokens.delete(token); tokenExpiry.delete(token) }, TOKEN_TTL)
  return { token: raw, expiresAt }
}

function validateToken(token: string): boolean {
  const hashed = hashToken(token)
  if (!activeTokens.has(hashed)) return false
  const expiresAt = tokenExpiry.get(hashed)
  if (!expiresAt || Date.now() > expiresAt) {
    activeTokens.delete(hashed); tokenExpiry.delete(hashed)
    return false
  }
  return true
}

function getTokenFromRequest(request: FastifyRequest): string | null {
  const auth = request.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  const query = request.query as Record<string, string>
  if (query?.token) return query.token
  return null
}

function getLoginHtml(): string {
  const paths = [
    join(__dirname, '..', '..', 'node_modules', '@html-to-pdf', 'templates', 'dist', 'templates', 'admin', 'login.html'),
    join(__dirname, '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', 'login.html'),
    join(__dirname, '..', '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', 'login.html'),
  ]
  for (const p of paths) {
    if (existsSync(p)) return readFileSync(p, 'utf-8')
  }
  return '<html><body><h1>Login template not found</h1></body></html>'
}

function getLoginCss(): string {
  const paths = [
    join(__dirname, '..', '..', 'node_modules', '@html-to-pdf', 'templates', 'dist', 'templates', 'admin', 'login.css'),
    join(__dirname, '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', 'login.css'),
    join(__dirname, '..', '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', 'login.css'),
  ]
  for (const p of paths) { if (existsSync(p)) return readFileSync(p, 'utf-8') }
  return ''
}

function getAdminHtml(): string {
  const paths = [
    join(__dirname, '..', '..', 'node_modules', '@html-to-pdf', 'templates', 'dist', 'templates', 'admin', 'index.html'),
    join(__dirname, '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', 'index.html'),
    join(__dirname, '..', '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', 'index.html'),
  ]
  for (const p of paths) { if (existsSync(p)) return readFileSync(p, 'utf-8') }
  return '<html><body><h1>Admin template not found</h1></body></html>'
}

function getAdminCss(): string {
  const paths = [
    join(__dirname, '..', '..', 'node_modules', '@html-to-pdf', 'templates', 'dist', 'templates', 'admin', 'style.css'),
    join(__dirname, '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', 'style.css'),
    join(__dirname, '..', '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', 'style.css'),
  ]
  for (const p of paths) { if (existsSync(p)) return readFileSync(p, 'utf-8') }
  return ''
}

async function securityCheck(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const ip = getClientIp(request)
  if (isBlockedUserAgent(request)) { recordAttempt(ip, true); reply.status(403).send({ error: 'Acesso negado' }); return false }
  if (hasSuspiciousHeaders(request)) { recordAttempt(ip, true); reply.status(403).send({ error: 'Acesso negado' }); return false }
  const rateCheck = isRateLimited(ip)
  if (rateCheck.blocked) { reply.status(429).header('Retry-After', String(rateCheck.retryAfter || 300)).send({ error: rateCheck.reason, retryAfter: rateCheck.retryAfter }); return false }
  return true
}

// ── Login Page ──────────────────────────────────────────────
export async function loginPageRoute(request: FastifyRequest, reply: FastifyReply) {
  if (!await securityCheck(request, reply)) return
  let html = getLoginHtml()
  const css = getLoginCss()
  const host = request.headers.host || 'chatgpt-to-pdf-local.onrender.com'
  const apiBase = `https://${host}`
  const formNonce = randomBytes(16).toString('hex')
  const formHash = createHash('sha256').update(formNonce + ADMIN_SECRET).digest('hex').slice(0, 12)
  html = html.replace('{{TITLE}}', 'PDF Engine').replace('{{CSS}}', css).replace('{{API_BASE}}', apiBase).replace('{{ANIMATION_LABEL}}', '🔐 Insira suas credenciais').replace('{{FORM_NONCE}}', formNonce).replace('{{FORM_HASH}}', formHash)
  return reply.type('text/html').send(html)
}

// ── Login API ──────────────────────────────────────────────
export async function loginApiRoute(request: FastifyRequest, reply: FastifyReply) {
  const ip = getClientIp(request)
  if (!await securityCheck(request, reply)) return

  // Parse body (JSON or urlencoded)
  const body = request.body as Record<string, unknown> || {}
  const username = String(body['username'] || '')
  const password = String(body['password'] || '')
  const honeypotValue = String(body[HONEYPOT_FIELD] || '')
  const nonce = String(body['_nonce'] || '')
  const hash = String(body['_hash'] || '')

  // Honeypot
  if (honeypotValue) {
    recordAttempt(ip, true, true)
    return reply.send({ token: 'invalid', message: 'ok' })
  }

  // Validate nonce
  if (nonce && hash) {
    const expectedHash = createHash('sha256').update(nonce + ADMIN_SECRET).digest('hex').slice(0, 12)
    if (hash !== expectedHash) {
      recordAttempt(ip, true)
      return reply.status(401).send({ error: 'Sessão inválida. Recarregue a página.' })
    }
  }

  if (!username || !password) {
    recordAttempt(ip, true)
    return reply.status(400).send({ error: 'Usuário e senha são obrigatórios' })
  }

  if (hasMaliciousPayload(username) || hasMaliciousPayload(password)) {
    recordAttempt(ip, true)
    return reply.status(403).send({ error: 'Acesso negado' })
  }

  const delay = getCalculatedDelay(ip)
  if (delay > 0) await new Promise(r => setTimeout(r, delay))

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    recordAttempt(ip, true)
    return reply.status(401).send({ error: 'Credenciais inválidas' })
  }

  rateLimitMap.delete(ip)
  const { token, expiresAt } = generateToken()
  return reply.send({ token, expiresAt, user: { username: ADMIN_USER }, message: 'Autenticado com sucesso' })
}

// ── Verify Token ────────────────────────────────────────────
export async function verifyTokenRoute(request: FastifyRequest, reply: FastifyReply) {
  if (!await securityCheck(request, reply)) return
  const token = getTokenFromRequest(request)
  if (!token || !validateToken(token)) return reply.status(401).send({ valid: false, error: 'Token inválido ou expirado' })
  return reply.send({ valid: true })
}

// ── Admin Dashboard ─────────────────────────────────────────
export async function adminRoute(request: FastifyRequest, reply: FastifyReply) {
  if (!await securityCheck(request, reply)) return
  const token = getTokenFromRequest(request)
  if (!token || !validateToken(token)) return reply.redirect('/admin/login')

  let html = getAdminHtml()
  const css = getAdminCss()
  const host = request.headers.host || 'chatgpt-to-pdf-local.onrender.com'
  const apiBase = `https://${host}`
  let redisConnected = false
  if (redis) { try { await redis.ping(); redisConnected = true } catch {} }

  html = html.replace('{{TITLE}}', 'PDF Engine').replace('{{CSS}}', css).replace('{{VERSION}}', '1.0.0')
    .replace('{{STATUS_CLASS}}', redisConnected ? 'online' : 'offline')
    .replace('{{STATUS_TEXT}}', redisConnected ? '🟢 Backend online' : '🔴 Backend offline')
    .replace('{{PAGE_TITLE}}', '📊 Visão Geral').replace('{{ENVIRONMENT}}', process.env.NODE_ENV || 'production')
    .replace('{{API_BASE}}', apiBase)
  return reply.type('text/html').send(html)
}

// ── Admin API Endpoints ─────────────────────────────────────
export async function adminJobsApi(request: FastifyRequest, reply: FastifyReply) {
  if (!await securityCheck(request, reply)) return
  const token = getTokenFromRequest(request)
  if (!token || !validateToken(token)) return reply.status(401).send({ error: 'Não autenticado' })
  const limit = Math.min(parseInt(String((request.query as Record<string, string>).limit) || '50', 10) || 50, 100)
  if (!redis) return reply.send([])
  try {
    await redis.ping()
    const keys = await redis.keys('job:*')
    keys.sort()
    const recentKeys = keys.slice(-limit)
    const jobs = []
    for (const key of recentKeys) {
      const data = await redis.get(key)
      if (data) { try { jobs.push(JSON.parse(data)) } catch {} }
    }
    jobs.reverse()
    return reply.send(jobs)
  } catch { return reply.send([]) }
}

export async function adminRedisApi(_request: FastifyRequest, reply: FastifyReply) {
  if (!redis) return reply.send({ status: 'not_configured', message: 'REDIS_URL not configured' })
  try {
    await redis.ping()
    const info = await redis.info()
    const parsed: Record<string, string> = {}
    for (const line of info.split('\r\n').filter(l => l && !l.startsWith('#'))) {
      const [key, ...vals] = line.split(':')
      if (key && vals.length) parsed[key.trim()] = vals.join(':').trim()
    }
    const keys = await redis.keys('job:*')
    return reply.send({ status: 'connected', totalKeys: keys.length, usedMemory: parsed.used_memory_human || 'unknown', connectedClients: parsed.connected_clients || 'unknown', uptimeInDays: parsed.uptime_in_days || 'unknown', serverVersion: parsed.redis_version || 'unknown', os: parsed.os || 'unknown' })
  } catch (err) { return reply.send({ status: 'disconnected', message: err instanceof Error ? err.message : 'Unknown error' }) }
}

export async function adminLogsApi(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ logs: [{ timestamp: new Date(startTime).toISOString(), level: 'info', message: 'Server started' }, { timestamp: new Date().toISOString(), level: 'info', message: 'Admin dashboard accessed' }], total: 2 })
}
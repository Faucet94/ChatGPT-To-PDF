import { FastifyReply, FastifyRequest } from 'fastify'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createRedisClient } from '@html-to-pdf/queue'
import { createHash, randomBytes } from 'crypto'

const startTime = Date.now()

// ── Credenciais do Admin ────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER
const ADMIN_PASS = process.env.ADMIN_PASS
const ADMIN_SECRET = process.env.ADMIN_SECRET || randomBytes(32).toString('hex')
const ADMIN_CONFIGURED = Boolean(ADMIN_USER && ADMIN_PASS)

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

const BLOCKED_USER_AGENTS = ['sqlmap','gobuster','dirbuster','nmap','nikto','wfuzz','ffuf','zap','burp','acunetix','nessus','openvas','python-requests','python-urllib','python-httpx','aiohttp','curl','wget','libcurl','httpx','feroxbuster','masscan','hydra','medusa','thc','patator','go-http-client','Go-http-client','fasthttp','zgrab','jael','jaeles']
const SUSPICIOUS_HEADERS = ['x-fuzz','x-scanner','x-attack','x-security','x-probe','x-enum','x-brute','x-crawl','fuzz','scan','attack','probe']
const MALICIOUS_PATTERNS = [
  /(\b(select|union|insert|delete|drop|alter|create|truncate|exec|declare|cast|convert)\b)/i,
  /(<script|javascript:|onerror=|onload=|alert\(|prompt\(|confirm\()/i,
  /(\.\.\/|\.\.\\|\.\.%2f|\.\.%5c|%00|%0d%0a)/i,
  /(\b(bash|cmd|powershell|sh\s|wget\s|curl\s|nc\s)\b)/i,
  /(['";=]|--|#)/i,
]
const HONEYPOT_FIELD = 'website_url'

setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.blockedUntil && now - entry.firstAttempt > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(ip)
  }
}, 5 * 60 * 1000)

function getClientIp(r: FastifyRequest): string {
  const f = r.headers['x-forwarded-for']
  if (typeof f === 'string') return f.split(',')[0].trim()
  return r.ip || 'unknown'
}

function isBlockedUserAgent(r: FastifyRequest): boolean {
  const ua = (r.headers['user-agent'] || '').toLowerCase()
  return BLOCKED_USER_AGENTS.some(p => ua.includes(p.toLowerCase()))
}

function hasSuspiciousHeaders(r: FastifyRequest): boolean {
  for (const key of Object.keys(r.headers)) {
    if (SUSPICIOUS_HEADERS.some(s => key.toLowerCase().includes(s.toLowerCase()))) return true
  }
  return false
}

function hasMaliciousPayload(v: string): boolean {
  return MALICIOUS_PATTERNS.some(p => p.test(v))
}

function isRateLimited(ip: string): { blocked: boolean; reason?: string; retryAfter?: number } {
  const e = rateLimitMap.get(ip)
  if (!e) return { blocked: false }
  const now = Date.now()
  if (now < e.blockedUntil) return { blocked: true, reason: e.honeypotFailed ? 'Acesso bloqueado' : 'Muitas tentativas', retryAfter: Math.ceil((e.blockedUntil - now) / 1000) }
  if (now - e.firstAttempt > RATE_LIMIT_WINDOW) { rateLimitMap.delete(ip); return { blocked: false } }
  if (e.count >= RATE_LIMIT_MAX_ATTEMPTS) { e.blockedUntil = now + RATE_LIMIT_BLOCK_DURATION; return { blocked: true, reason: 'Muitas tentativas. Tente em 30 min.', retryAfter: RATE_LIMIT_BLOCK_DURATION / 1000 } }
  return { blocked: false }
}

function recordAttempt(ip: string, failed: boolean, honeypot = false) {
  const now = Date.now()
  let e = rateLimitMap.get(ip)
  if (!e) { e = { count: 0, firstAttempt: now, lastAttempt: now, blockedUntil: 0, honeypotFailed: false }; rateLimitMap.set(ip, e) }
  e.lastAttempt = now
  if (failed) e.count++
  if (honeypot) { e.honeypotFailed = true; e.blockedUntil = now + RATE_LIMIT_HONEYPOT_BLOCK }
}

function getDelay(ip: string): number {
  const e = rateLimitMap.get(ip)
  if (!e || e.count === 0) return 0
  return Math.min(500 * Math.pow(2, e.count - 1), 8000)
}

// ── Token Management ────────────────────────────────────────
const activeTokens = new Set<string>()
const tokenExpiry = new Map<string, number>()
const loginNonces = new Map<string, number>()
const TOKEN_TTL = 24 * 60 * 60 * 1000
const LOGIN_NONCE_TTL = 10 * 60 * 1000

const redis = process.env.REDIS_URL
  ? createRedisClient({
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
    })
  : null

function hashToken(t: string): string { return createHash('sha256').update(t + ADMIN_SECRET).digest('hex') }
function createLoginNonce(): string {
  const nonce = randomBytes(32).toString('hex')
  loginNonces.set(nonce, Date.now() + LOGIN_NONCE_TTL)
  setTimeout(() => loginNonces.delete(nonce), LOGIN_NONCE_TTL)
  return nonce
}
function validateLoginNonce(nonce: string): boolean {
  const expiresAt = loginNonces.get(nonce)
  loginNonces.delete(nonce)
  return Boolean(expiresAt && Date.now() <= expiresAt)
}
function generateToken() {
  const raw = randomBytes(48).toString('hex')
  const token = hashToken(raw)
  const expiresAt = Date.now() + TOKEN_TTL
  activeTokens.add(token); tokenExpiry.set(token, expiresAt)
  setTimeout(() => { activeTokens.delete(token); tokenExpiry.delete(token) }, TOKEN_TTL)
  return { token: raw, expiresAt }
}
function validateToken(t: string): boolean {
  const h = hashToken(t)
  if (!activeTokens.has(h)) return false
  const ex = tokenExpiry.get(h)
  if (!ex || Date.now() > ex) { activeTokens.delete(h); tokenExpiry.delete(h); return false }
  return true
}
function getToken(r: FastifyRequest): string | null {
  const a = r.headers.authorization
  if (a?.startsWith('Bearer ')) return a.slice(7)
  const q = r.query as Record<string, string>
  return q?.token || null
}

function replaceAll(s: string, search: string, replace: string): string { return s.split(search).join(replace) }

function readTpl(name: string): string {
  const paths = [
    join(__dirname, '..', '..', 'node_modules', '@html-to-pdf', 'templates', 'dist', 'templates', 'admin', name),
    join(__dirname, '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', name),
    join(__dirname, '..', '..', '..', '..', '..', 'packages', 'templates', 'src', 'templates', 'admin', name),
  ]
  for (const p of paths) { if (existsSync(p)) return readFileSync(p, 'utf-8') }
  return ''
}

async function securityCheck(r: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const ip = getClientIp(r)
  if (isBlockedUserAgent(r)) { recordAttempt(ip, true); reply.status(403).send({ error: 'Acesso negado' }); return false }
  if (hasSuspiciousHeaders(r)) { recordAttempt(ip, true); reply.status(403).send({ error: 'Acesso negado' }); return false }
  const rc = isRateLimited(ip)
  if (rc.blocked) { reply.status(429).header('Retry-After', String(rc.retryAfter || 300)).send({ error: rc.reason }); return false }
  return true
}

// ── Login Page ──────────────────────────────────────────────
export async function loginPageRoute(request: FastifyRequest, reply: FastifyReply) {
  if (!await securityCheck(request, reply)) return
  if (!ADMIN_CONFIGURED) {
    return reply.status(503).send('Admin credentials are not configured')
  }
  let html = readTpl('login.html')
  const css = readTpl('login.css')
  const apiBase = `https://${request.headers.host || 'chatgpt-to-pdf-local.onrender.com'}`
  const nonce = createLoginNonce()
  html = replaceAll(html, '{{TITLE}}', 'PDF Engine')
  html = replaceAll(html, '{{CSS}}', css)
  html = replaceAll(html, '{{API_BASE}}', apiBase)
  html = replaceAll(html, '{{ANIMATION_LABEL}}', '🔐 Insira suas credenciais')
  html = replaceAll(html, '{{FORM_NONCE}}', nonce)
  return reply.type('text/html').send(html)
}

// ── Login API ──────────────────────────────────────────────
export async function loginApiRoute(request: FastifyRequest, reply: FastifyReply) {
  const ip = getClientIp(request)
  if (!await securityCheck(request, reply)) return
  if (!ADMIN_CONFIGURED) {
    return reply.status(503).send({ error: 'Admin credentials are not configured' })
  }
  const body = request.body as Record<string, unknown> || {}
  const username = String(body['username'] || '')
  const password = String(body['password'] || '')
  const honeypotValue = String(body[HONEYPOT_FIELD] || '')
  const nonce = String(body['_nonce'] || '')

  if (honeypotValue) { recordAttempt(ip, true, true); return reply.send({ token: 'invalid', message: 'ok' }) }
  if (!validateLoginNonce(nonce)) { recordAttempt(ip, true); return reply.status(401).send({ error: 'Sessão inválida. Recarregue a página.' }) }
  if (!username || !password) { recordAttempt(ip, true); return reply.status(400).send({ error: 'Usuário e senha obrigatórios' }) }
  if (hasMaliciousPayload(username) || hasMaliciousPayload(password)) { recordAttempt(ip, true); return reply.status(403).send({ error: 'Acesso negado' }) }

  const delay = getDelay(ip)
  if (delay > 0) await new Promise(r => setTimeout(r, delay))

  if (username !== ADMIN_USER || password !== ADMIN_PASS) { recordAttempt(ip, true); return reply.status(401).send({ error: 'Credenciais inválidas' }) }

  rateLimitMap.delete(ip)
  const t = generateToken()
  return reply.send({ token: t.token, expiresAt: t.expiresAt, user: { username: ADMIN_USER }, message: 'Autenticado com sucesso' })
}

// ── Verify Token ────────────────────────────────────────────
export async function verifyTokenRoute(request: FastifyRequest, reply: FastifyReply) {
  if (!await securityCheck(request, reply)) return
  if (!ADMIN_CONFIGURED) return reply.redirect('/admin/login')
  const token = getToken(request)
  if (!token || !validateToken(token)) return reply.status(401).send({ valid: false, error: 'Token inválido' })
  return reply.send({ valid: true })
}

// ── Admin Dashboard ─────────────────────────────────────────
export async function adminRoute(request: FastifyRequest, reply: FastifyReply) {
  if (!await securityCheck(request, reply)) return
  const token = getToken(request)
  if (!token || !validateToken(token)) return reply.redirect('/admin/login')

  let html = readTpl('index.html')
  const css = readTpl('style.css')
  const apiBase = `https://${request.headers.host || 'chatgpt-to-pdf-local.onrender.com'}`
  let redisConnected = false
  if (redis) { try { await redis.ping(); redisConnected = true } catch {} }

  html = replaceAll(html, '{{TITLE}}', 'PDF Engine')
  html = replaceAll(html, '{{CSS}}', css)
  html = replaceAll(html, '{{VERSION}}', '1.0.0')
  html = replaceAll(html, '{{STATUS_CLASS}}', redisConnected ? 'online' : 'offline')
  html = replaceAll(html, '{{STATUS_TEXT}}', redisConnected ? '🟢 Backend online' : '🔴 Backend offline')
  html = replaceAll(html, '{{PAGE_TITLE}}', '📊 Visão Geral')
  html = replaceAll(html, '{{ENVIRONMENT}}', process.env.NODE_ENV || 'production')
  html = replaceAll(html, '{{API_BASE}}', apiBase)
  return reply.type('text/html').send(html)
}

// ── Admin API Endpoints ─────────────────────────────────────
export async function adminJobsApi(request: FastifyRequest, reply: FastifyReply) {
  if (!await securityCheck(request, reply)) return
  const token = getToken(request)
  if (!token || !validateToken(token)) return reply.status(401).send({ error: 'Não autenticado' })
  const limit = Math.min(parseInt(String((request.query as Record<string, string>).limit) || '50', 10) || 50, 100)
  if (!redis) return reply.send([])
  try {
    await redis.ping()
    const keys = await redis.keys('job:*')
    keys.sort()
    const recentKeys = keys.slice(-limit)
    const jobs = []
    for (const key of recentKeys) { const d = await redis.get(key); if (d) { try { jobs.push(JSON.parse(d)) } catch {} } }
    jobs.reverse()
    return reply.send(jobs)
  } catch { return reply.send([]) }
}

export async function adminRedisApi(_r: FastifyRequest, reply: FastifyReply) {
  if (!redis) return reply.send({ status: 'not_configured', message: 'REDIS_URL not configured' })
  try {
    await redis.ping()
    const info = await redis.info()
    const parsed: Record<string, string> = {}
    for (const line of info.split('\r\n').filter(l => l && !l.startsWith('#'))) {
      const [k, ...v] = line.split(':')
      if (k && v.length) parsed[k.trim()] = v.join(':').trim()
    }
    const keys = await redis.keys('job:*')
    return reply.send({ status: 'connected', totalKeys: keys.length, usedMemory: parsed.used_memory_human || 'unknown', connectedClients: parsed.connected_clients || 'unknown', uptimeInDays: parsed.uptime_in_days || 'unknown', serverVersion: parsed.redis_version || 'unknown', os: parsed.os || 'unknown' })
  } catch (e) { return reply.send({ status: 'disconnected', message: e instanceof Error ? e.message : 'Unknown' }) }
}

export async function adminLogsApi(_r: FastifyRequest, reply: FastifyReply) {
  return reply.send({ logs: [{ timestamp: new Date(startTime).toISOString(), level: 'info', message: 'Server started' }, { timestamp: new Date().toISOString(), level: 'info', message: 'Admin dashboard accessed' }], total: 2 })
}

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import PostalMime from 'postal-mime'
import { z } from 'zod'
import type { Context, MiddlewareHandler } from 'hono'
import type {
  D1Database,
  ForwardableEmailMessage,
  ExecutionContext,
  ReadableStream,
  ScheduledEvent,
} from '@cloudflare/workers-types'
import { normalizeLocalPart } from '../shared/local-part.ts'
import {
  applyFilters,
  buildEml,
  buildMbox,
  ftsIndex,
  ftsQuery,
  hardDeleteEmails,
  loadFilters,
  notifyWebhook,
  purgeOldEmails,
  type AddrMeta,
  type AttachmentMeta,
  type Folder,
} from './p2.ts'

type Env = {
  DB: D1Database
  LEMONMAIL_DOMAIN?: string
  MAILBOX_QUOTA_MB?: string
  TURNSTILE_SECRET?: string
  INVITE_CODE?: string
  MAILBOX_MAX_TOTAL?: string
  MAILBOX_CREATE_PER_IP_HOUR?: string
  LOGIN_PER_IP_WINDOW?: string
  LOGIN_PER_ADDR_WINDOW?: string
  /** Admin bearer token for /api/admin/* */
  ADMIN_TOKEN?: string
  /** Optional POST webhook on inbound mail */
  MAIL_WEBHOOK_URL?: string
  /** Delete emails older than N days (0 = off). Default 0. */
  EMAIL_MAX_AGE_DAYS?: string
}

type AppVars = { mailboxId: string; sessionToken: string }
type AppEnv = { Bindings: Env; Variables: AppVars }

const MAX_EMAIL_SIZE = 1024 * 1024
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PBKDF2_ITERATIONS = 100_000
const RATE_WINDOW_LOGIN_MS = 15 * 60 * 1000
const RATE_WINDOW_CREATE_MS = 60 * 60 * 1000
/** Anti-abuse: same device may own at most one mailbox. */
const ABUSE_IP_LIMIT_NO_FINGERPRINT = 3
const ABUSE_IP_LIMIT_TOTAL = 8

type RegistrationStatus = 'accepted' | 'rejected_device' | 'rejected_ip' | 'rejected_other'

type LogLevel = 'info' | 'warn' | 'error'

/** Structured JSON log line — inspect via `wrangler tail`. */
function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }))
}

type MailboxRow = {
  id: string
  localPart: string
  passwordSalt: string
  passwordHash: string
  createdAt: string
  usedBytes?: number
}

type EmailRow = {
  id: string
  sender: string
  senderName: string | null
  subject: string
  bodyText: string | null
  bodyHtml: string | null
  size: number
  isRead: number
  receivedAt: string
  toAddrs: string | null
  ccAddrs: string | null
  messageId: string | null
  attachmentsJson: string | null
  isStarred: number
  folder: string
  labelsJson: string | null
}

const mailboxInput = z.object({
  localPart: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(128),
  'cf-turnstile-response': z.string().optional().default(''),
  inviteCode: z.string().trim().max(128).optional(),
})

const loginInput = z.object({
  password: z.string().min(1),
})

const loginByAddressInput = z.object({
  localPart: z.string().trim().min(1).max(64),
  password: z.string().min(1),
  'cf-turnstile-response': z.string().optional().default(''),
})

const changePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
})

const patchReadInput = z.object({
  isRead: z.boolean(),
})

const bulkDeleteInput = z.object({
  mode: z.enum(['ids', 'oldest', 'all']).default('ids'),
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
  count: z.number().int().min(1).max(100).optional(),
})

const patchEmailInput = z.object({
  isStarred: z.boolean().optional(),
  folder: z.enum(['inbox', 'archive', 'trash']).optional(),
  labels: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
})

const filterInput = z.object({
  name: z.string().trim().max(64).optional().default(''),
  matchField: z.enum(['sender', 'subject', 'body']),
  matchOp: z.enum(['contains', 'equals']).default('contains'),
  matchValue: z.string().trim().min(1).max(200),
  action: z.enum(['delete', 'star', 'archive', 'mark_read', 'label']),
  enabled: z.boolean().optional().default(true),
})

const blockPrefixInput = z.object({
  localPart: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(200).optional(),
})

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function quotaBytes(env: Env): number {
  return (parsePositiveInt(env.MAILBOX_QUOTA_MB, 10) || 10) * 1024 * 1024
}

function escapeLike(q: string): string {
  return q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function mapEmail(e: EmailRow) {
  let attachments: AttachmentMeta[] = []
  if (e.attachmentsJson) {
    try {
      attachments = JSON.parse(e.attachmentsJson) as AttachmentMeta[]
    } catch {
      attachments = []
    }
  }
  let to: AddrMeta[] = []
  let cc: AddrMeta[] = []
  if (e.toAddrs) {
    try {
      to = JSON.parse(e.toAddrs) as AddrMeta[]
    } catch {
      to = []
    }
  }
  if (e.ccAddrs) {
    try {
      cc = JSON.parse(e.ccAddrs) as AddrMeta[]
    } catch {
      cc = []
    }
  }
  let labels: string[] = []
  if (e.labelsJson) {
    try {
      labels = JSON.parse(e.labelsJson) as string[]
    } catch {
      labels = []
    }
  }
  return {
    id: e.id,
    sender: e.sender,
    senderName: e.senderName,
    subject: e.subject,
    size: e.size,
    isRead: Number(e.isRead) === 1,
    isStarred: Number(e.isStarred) === 1,
    folder: (e.folder || 'inbox') as Folder,
    labels,
    receivedAt: e.receivedAt,
    bodyText: e.bodyText,
    bodyHtml: e.bodyHtml,
    to,
    cc,
    messageId: e.messageId,
    attachments,
  }
}

function mapEmailSummary(e: EmailRow) {
  const full = mapEmail(e)
  return {
    id: full.id,
    sender: full.sender,
    senderName: full.senderName,
    subject: full.subject,
    size: full.size,
    isRead: full.isRead,
    isStarred: full.isStarred,
    folder: full.folder,
    labels: full.labels,
    receivedAt: full.receivedAt,
    attachmentCount: full.attachments.length,
  }
}

function formatAddrs(
  list: { address?: string; name?: string }[] | { address?: string; name?: string } | undefined,
): AddrMeta[] {
  if (!list) return []
  const arr = Array.isArray(list) ? list : [list]
  return arr
    .map((a) => ({
      name: (a.name ?? '').trim(),
      address: (a.address ?? '').trim(),
    }))
    .filter((a) => a.address)
}

async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function requestClientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

async function consumeRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  if (limit <= 0) return true
  const now = Date.now()
  const row = await db
    .prepare('SELECT count AS count, window_start AS windowStart FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ count: number; windowStart: number }>()

  if (!row || now - row.windowStart >= windowMs) {
    await db
      .prepare(
        'INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start',
      )
      .bind(key, now)
      .run()
    return true
  }
  if (row.count >= limit) return false
  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run()
  return true
}

async function verifyTurnstile(env: Env, token: string, remoteip: string | undefined): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true
  if (!token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        ...(remoteip && remoteip !== 'unknown' ? { remoteip } : {}),
      }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

const app = new Hono<AppEnv>()

app.use('/api/*', cors({ origin: 'https://mail.lemonhub.net' }))

app.use('/api/*', async (c, next) => {
  const start = Date.now()
  await next()
  log('info', 'api.request', { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start })
})

app.onError((err, c) => {
  log('error', 'api.error', { method: c.req.method, path: c.req.path, message: err.message })
  return c.json({ code: 'internal_error' }, 500)
})

const sessionAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return c.json({ code: 'unauthorized' }, 401)
  const session = await c.env.DB.prepare(
    'SELECT mailbox_id AS mailboxId, expires_at AS expiresAt FROM auth_sessions WHERE token = ?',
  )
    .bind(token)
    .first<{ mailboxId: string; expiresAt: string }>()
  if (!session || Date.parse(session.expiresAt) < Date.now()) {
    if (session) {
      await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token = ?').bind(token).run()
    }
    return c.json({ code: 'session_expired' }, 401)
  }
  c.set('mailboxId', session.mailboxId)
  c.set('sessionToken', token)
  return next()
}

function assertMailbox(c: Context<AppEnv>, id: string): boolean {
  return id === c.get('mailboxId')
}

async function issueSession(db: D1Database, mailboxId: string): Promise<{ token: string; expiresAt: string }> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  await db
    .prepare('INSERT INTO auth_sessions (token, mailbox_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, mailboxId, now.toISOString(), expiresAt)
    .run()
  return { token, expiresAt }
}

async function verifyMailboxPassword(row: MailboxRow, password: string): Promise<boolean> {
  if (!row.passwordSalt || !row.passwordHash) return false
  const salt = Uint8Array.from(row.passwordSalt.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  const expected = await hashPassword(password, salt)
  return constantTimeEqual(expected, row.passwordHash)
}

async function getQuotaSnapshot(db: D1Database, mailboxId: string, env: Env) {
  const mb = await db
    .prepare('SELECT used_bytes AS usedBytes FROM mailboxes WHERE id = ?')
    .bind(mailboxId)
    .first<{ usedBytes: number }>()
  const used =
    mb?.usedBytes ??
    (
      await db
        .prepare('SELECT COALESCE(SUM(size), 0) AS used FROM emails WHERE mailbox_id = ?')
        .bind(mailboxId)
        .first<{ used: number }>()
    )?.used ??
    0
  const totalRow = await db
    .prepare('SELECT COUNT(*) AS total FROM emails WHERE mailbox_id = ?')
    .bind(mailboxId)
    .first<{ total: number }>()
  const unreadRow = await db
    .prepare(
      "SELECT COUNT(*) AS unread FROM emails WHERE mailbox_id = ? AND is_read = 0 AND folder != 'trash'",
    )
    .bind(mailboxId)
    .first<{ unread: number }>()
  const { results: folderRows } = await db
    .prepare('SELECT folder, COUNT(*) AS count FROM emails WHERE mailbox_id = ? GROUP BY folder')
    .bind(mailboxId)
    .all<{ folder: string; count: number }>()
  const folders: Record<string, number> = { inbox: 0, archive: 0, trash: 0 }
  for (const r of folderRows) folders[r.folder] = r.count
  const starredRow = await db
    .prepare(
      "SELECT COUNT(*) AS starred FROM emails WHERE mailbox_id = ? AND is_starred = 1 AND folder != 'trash'",
    )
    .bind(mailboxId)
    .first<{ starred: number }>()
  return {
    quota: { used, limit: quotaBytes(env) },
    total: totalRow?.total ?? 0,
    unread: unreadRow?.unread ?? 0,
    folders,
    starred: starredRow?.starred ?? 0,
  }
}

const EMAIL_SUMMARY_COLS =
  `id, sender, sender_name AS senderName, subject, size, is_read AS isRead, is_starred AS isStarred,
   folder, labels_json AS labelsJson, received_at AS receivedAt, attachments_json AS attachmentsJson`
const EMAIL_DETAIL_COLS =
  `${EMAIL_SUMMARY_COLS}, body_text AS bodyText, body_html AS bodyHtml, to_addrs AS toAddrs, cc_addrs AS ccAddrs, message_id AS messageId`

const adminAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = c.env.ADMIN_TOKEN?.trim()
  if (!secret) return c.json({ code: 'admin_disabled' }, 503)
  const auth = c.req.header('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : c.req.header('X-Admin-Token') ?? ''
  if (!token || token.length !== secret.length || !constantTimeEqual(token, secret)) {
    return c.json({ code: 'admin_unauthorized' }, 401)
  }
  return next()
}

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    domain: c.env.LEMONMAIL_DOMAIN ?? 'lemonhub.net',
    inviteRequired: Boolean(c.env.INVITE_CODE && c.env.INVITE_CODE.length > 0),
    turnstileRequired: Boolean(c.env.TURNSTILE_SECRET && c.env.TURNSTILE_SECRET.length > 0),
    adminEnabled: Boolean(c.env.ADMIN_TOKEN && c.env.ADMIN_TOKEN.length > 0),
    webhookEnabled: Boolean(c.env.MAIL_WEBHOOK_URL && c.env.MAIL_WEBHOOK_URL.length > 0),
    emailMaxAgeDays: parsePositiveInt(c.env.EMAIL_MAX_AGE_DAYS, 0),
  }),
)

async function recordRegistration(
  db: D1Database,
  localPart: string,
  deviceId: string | null,
  ip: string,
  status: RegistrationStatus,
): Promise<void> {
  await db
    .prepare('INSERT INTO registrations (id, local_part, device_id, ip, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), localPart, deviceId, ip, status, new Date().toISOString())
    .run()
}

app.post('/api/mailboxes', zValidator('json', mailboxInput), async (c) => {
  const input = c.req.valid('json')
  const ip = requestClientIp(c)
  const deviceId = (c.req.header('device-id') ?? '').trim().slice(0, 128) || null

  const createPerHour = parsePositiveInt(c.env.MAILBOX_CREATE_PER_IP_HOUR, 3)
  if (!(await consumeRateLimit(c.env.DB, `create:ip:${ip}`, createPerHour, RATE_WINDOW_CREATE_MS))) {
    return c.json({ code: 'rate_limited' }, 429)
  }

  if (!(await verifyTurnstile(c.env, input['cf-turnstile-response'] ?? '', ip))) {
    return c.json({ code: 'turnstile_failed' }, 403)
  }

  const invite = c.env.INVITE_CODE?.trim()
  if (invite) {
    const provided = input.inviteCode ?? ''
    if (provided.length !== invite.length || !constantTimeEqual(provided, invite)) {
      return c.json({ code: 'invalid_invite' }, 403)
    }
  }

  const maxTotal = parsePositiveInt(c.env.MAILBOX_MAX_TOTAL, 500)
  if (maxTotal > 0) {
    const countRow = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM mailboxes').first<{ total: number }>()
    if (countRow && countRow.total >= maxTotal) {
      return c.json({ code: 'mailbox_limit_reached' }, 403)
    }
  }

  const normalized = normalizeLocalPart(input.localPart)
  if (!normalized.ok) return c.json({ code: normalized.code }, 400)
  const localPart = normalized.value

  const blocked = await c.env.DB.prepare('SELECT local_part FROM blocked_prefixes WHERE local_part = ?')
    .bind(localPart)
    .first()
  if (blocked) return c.json({ code: 'prefix_blocked' }, 403)

  // ── Anti-abuse: one person, one mailbox ──
  const countByIp = async (): Promise<number> => {
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM mailboxes WHERE creator_ip = ?').bind(ip).first<{ n: number }>()
    return row?.n ?? 0
  }

  if (deviceId) {
    // R1: the same device already owns a mailbox
    const owned = await c.env.DB.prepare('SELECT id FROM mailboxes WHERE device_id = ?').bind(deviceId).first()
    if (owned) {
      await recordRegistration(c.env.DB, localPart, deviceId, ip, 'rejected_device')
      log('warn', 'mailbox.rejected', { code: 'abuse.device_exists', localPart, ip, deviceId })
      return c.json({ code: 'abuse.device_exists' }, 409)
    }
  } else if ((await countByIp()) >= ABUSE_IP_LIMIT_NO_FINGERPRINT) {
    // R2: no fingerprint — only a small IP allowance
    await recordRegistration(c.env.DB, localPart, null, ip, 'rejected_ip')
    log('warn', 'mailbox.rejected', { code: 'abuse.ip_limit', localPart, ip })
    return c.json({ code: 'abuse.ip_limit' }, 409)
  }

  if ((await countByIp()) >= ABUSE_IP_LIMIT_TOTAL) {
    // R3: absolute IP ceiling regardless of fingerprint
    await recordRegistration(c.env.DB, localPart, deviceId, ip, 'rejected_ip')
    log('warn', 'mailbox.rejected', { code: 'abuse.ip_limit_total', localPart, ip, deviceId })
    return c.json({ code: 'abuse.ip_limit' }, 409)
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const passwordHash = await hashPassword(input.password, salt)
  const mailbox = { id: crypto.randomUUID(), localPart, createdAt: new Date().toISOString() }
  try {
    await c.env.DB.prepare(
      'INSERT INTO mailboxes (id, local_part, password_salt, password_hash, created_at, used_bytes, device_id, creator_ip) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    )
      .bind(mailbox.id, localPart, toHex(salt), passwordHash, mailbox.createdAt, deviceId, ip)
      .run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ code: 'mailbox_exists' }, 409)
    }
    throw err
  }
  await recordRegistration(c.env.DB, localPart, deviceId, ip, 'accepted')
  log('info', 'mailbox.created', { localPart, ip, deviceId })
  const session = await issueSession(c.env.DB, mailbox.id)
  return c.json({ ...mailbox, token: session.token, expiresAt: session.expiresAt }, 201)
})

app.delete('/api/mailboxes/:id', sessionAuth, async (c) => {
  const id = c.req.param('id')
  if (!assertMailbox(c, id)) return c.json({ code: 'forbidden' }, 403)
  await c.env.DB.prepare('DELETE FROM emails_fts WHERE mailbox_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM mail_filters WHERE mailbox_id = ?').bind(id).run()
  const result = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM emails WHERE mailbox_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM auth_sessions WHERE mailbox_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM mailboxes WHERE id = ?').bind(id),
  ])
  if (result[2].meta.changes === 0) return c.json({ code: 'not_found' }, 404)
  return c.body(null, 204)
})

/** Change password; revokes all sessions and issues a new token. */
app.post('/api/mailboxes/:id/password', sessionAuth, zValidator('json', changePasswordInput), async (c) => {
  const id = c.req.param('id')
  if (!assertMailbox(c, id)) return c.json({ code: 'forbidden' }, 403)
  const { currentPassword, newPassword } = c.req.valid('json')
  if (currentPassword === newPassword) {
    return c.json({ code: 'same_password' }, 400)
  }

  const row = await c.env.DB.prepare(
    'SELECT id, local_part AS localPart, password_salt AS passwordSalt, password_hash AS passwordHash, created_at AS createdAt FROM mailboxes WHERE id = ?',
  )
    .bind(id)
    .first<MailboxRow>()
  if (!row || !(await verifyMailboxPassword(row, currentPassword))) {
    return c.json({ code: 'wrong_credentials' }, 401)
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const passwordHash = await hashPassword(newPassword, salt)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE mailboxes SET password_salt = ?, password_hash = ? WHERE id = ?').bind(
      toHex(salt),
      passwordHash,
      id,
    ),
    c.env.DB.prepare('DELETE FROM auth_sessions WHERE mailbox_id = ?').bind(id),
  ])
  const session = await issueSession(c.env.DB, id)
  return c.json({ token: session.token, expiresAt: session.expiresAt })
})

app.post('/api/auth/login', zValidator('json', loginByAddressInput), async (c) => {
  const input = c.req.valid('json')
  const ip = requestClientIp(c)
  const localPartRaw = input.localPart.trim().toLowerCase()

  const perIp = parsePositiveInt(c.env.LOGIN_PER_IP_WINDOW, 30)
  const perAddr = parsePositiveInt(c.env.LOGIN_PER_ADDR_WINDOW, 10)
  if (!(await consumeRateLimit(c.env.DB, `login:ip:${ip}`, perIp, RATE_WINDOW_LOGIN_MS))) {
    return c.json({ code: 'rate_limited' }, 429)
  }
  if (!(await consumeRateLimit(c.env.DB, `login:ipaddr:${ip}:${localPartRaw}`, perAddr, RATE_WINDOW_LOGIN_MS))) {
    return c.json({ code: 'rate_limited' }, 429)
  }

  if (!(await verifyTurnstile(c.env, input['cf-turnstile-response'] ?? '', ip))) {
    return c.json({ code: 'turnstile_failed' }, 403)
  }

  const row = await c.env.DB.prepare(
    'SELECT id, local_part AS localPart, password_salt AS passwordSalt, password_hash AS passwordHash, created_at AS createdAt FROM mailboxes WHERE local_part = ?',
  )
    .bind(localPartRaw)
    .first<MailboxRow>()
  if (!row || !(await verifyMailboxPassword(row, input.password))) {
    log('warn', 'auth.login_failed', { localPart: localPartRaw, ip })
    return c.json({ code: 'wrong_credentials' }, 401)
  }
  const session = await issueSession(c.env.DB, row.id)
  log('info', 'auth.login', { localPart: row.localPart, ip })
  return c.json({
    token: session.token,
    expiresAt: session.expiresAt,
    mailbox: { id: row.id, localPart: row.localPart, createdAt: row.createdAt },
  })
})

app.post('/api/auth/logout', sessionAuth, async (c) => {
  const all = c.req.query('all') === '1'
  if (all) {
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE mailbox_id = ?').bind(c.get('mailboxId')).run()
  } else {
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token = ?').bind(c.get('sessionToken')).run()
  }
  return c.body(null, 204)
})

app.post('/api/mailboxes/:id/login', zValidator('json', loginInput), async (c) => {
  const id = c.req.param('id')
  const ip = requestClientIp(c)
  const perIp = parsePositiveInt(c.env.LOGIN_PER_IP_WINDOW, 30)
  if (!(await consumeRateLimit(c.env.DB, `login:ip:${ip}`, perIp, RATE_WINDOW_LOGIN_MS))) {
    return c.json({ code: 'rate_limited' }, 429)
  }
  if (!(await consumeRateLimit(c.env.DB, `login:id:${ip}:${id}`, 10, RATE_WINDOW_LOGIN_MS))) {
    return c.json({ code: 'rate_limited' }, 429)
  }

  const { password } = c.req.valid('json')
  const row = await c.env.DB.prepare(
    'SELECT id, local_part AS localPart, password_salt AS passwordSalt, password_hash AS passwordHash, created_at AS createdAt FROM mailboxes WHERE id = ?',
  )
    .bind(id)
    .first<MailboxRow>()
  if (!row || !(await verifyMailboxPassword(row, password))) {
    return c.json({ code: 'wrong_credentials' }, 401)
  }
  const session = await issueSession(c.env.DB, row.id)
  return c.json({
    token: session.token,
    expiresAt: session.expiresAt,
    mailbox: { id: row.id, localPart: row.localPart, createdAt: row.createdAt },
  })
})

app.get('/api/mailboxes/:id/emails', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  const id = c.req.param('id')
  if (!assertMailbox(c, id)) return c.json({ code: 'forbidden' }, 403)

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0)
  const unreadOnly = c.req.query('unread') === '1'
  const folder = (c.req.query('folder') ?? 'inbox').toLowerCase()
  const qRaw = (c.req.query('q') ?? '').trim().slice(0, 100)

  const conds: string[] = ['e.mailbox_id = ?']
  const binds: (string | number)[] = [mailboxId]
  if (folder === 'starred') {
    conds.push("e.is_starred = 1 AND e.folder != 'trash'")
  } else if (folder === 'all') {
    /* no folder filter */
  } else if (folder === 'inbox' || folder === 'archive' || folder === 'trash') {
    conds.push('e.folder = ?')
    binds.push(folder)
  } else {
    conds.push("e.folder = 'inbox'")
  }
  if (unreadOnly) conds.push('e.is_read = 0')

  let sqlFrom = 'emails e'
  const mq = qRaw ? ftsQuery(qRaw) : ''
  if (mq) {
    sqlFrom = 'emails e INNER JOIN emails_fts f ON f.email_id = e.id'
    conds.push('emails_fts MATCH ?')
    binds.push(mq)
  } else if (qRaw) {
    const like = `%${escapeLike(qRaw)}%`
    conds.push(
      `(e.subject LIKE ? ESCAPE '\\' OR e.sender LIKE ? ESCAPE '\\' OR IFNULL(e.sender_name,'') LIKE ? ESCAPE '\\')`,
    )
    binds.push(like, like, like)
  }

  const where = `WHERE ${conds.join(' AND ')}`
  const cols = `e.id, e.sender, e.sender_name AS senderName, e.subject, e.size, e.is_read AS isRead,
    e.is_starred AS isStarred, e.folder, e.labels_json AS labelsJson, e.received_at AS receivedAt,
    e.attachments_json AS attachmentsJson`

  const { results } = await c.env.DB.prepare(
    `SELECT ${cols} FROM ${sqlFrom} ${where} ORDER BY e.received_at DESC, e.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<EmailRow>()

  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM ${sqlFrom} ${where}`)
    .bind(...binds)
    .first<{ total: number }>()

  const snap = await getQuotaSnapshot(c.env.DB, mailboxId, c.env)
  return c.json({
    emails: results.map((e) => mapEmailSummary(e)),
    quota: snap.quota,
    total: snap.total,
    unread: snap.unread,
    folders: snap.folders,
    starred: snap.starred,
    matchedTotal: countRow?.total ?? 0,
    search: qRaw || null,
    folder,
  })
})

app.get('/api/mailboxes/:id/emails/:emailId', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  const email = await c.env.DB.prepare(
    `SELECT ${EMAIL_DETAIL_COLS} FROM emails WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(c.req.param('emailId'), mailboxId)
    .first<EmailRow>()
  if (!email) return c.json({ code: 'not_found' }, 404)
  await c.env.DB.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').bind(email.id).run()
  return c.json({ ...mapEmail({ ...email, isRead: 1 }), isRead: true })
})

app.patch(
  '/api/mailboxes/:id/emails/:emailId/read',
  sessionAuth,
  zValidator('json', patchReadInput),
  async (c) => {
    const mailboxId = c.get('mailboxId')
    if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
    const { isRead } = c.req.valid('json')
    const emailId = c.req.param('emailId')
    const existing = await c.env.DB.prepare('SELECT id FROM emails WHERE id = ? AND mailbox_id = ?')
      .bind(emailId, mailboxId)
      .first<{ id: string }>()
    if (!existing) return c.json({ code: 'not_found' }, 404)
    await c.env.DB.prepare('UPDATE emails SET is_read = ? WHERE id = ?')
      .bind(isRead ? 1 : 0, emailId)
      .run()
    const snap = await getQuotaSnapshot(c.env.DB, mailboxId, c.env)
    return c.json({ id: emailId, isRead, unread: snap.unread })
  },
)

app.post('/api/mailboxes/:id/emails/mark-all-read', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  await c.env.DB.prepare('UPDATE emails SET is_read = 1 WHERE mailbox_id = ? AND is_read = 0')
    .bind(mailboxId)
    .run()
  const snap = await getQuotaSnapshot(c.env.DB, mailboxId, c.env)
  return c.json({ ok: true, unread: 0, total: snap.total })
})

app.delete('/api/mailboxes/:id/emails/:emailId', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  const emailId = c.req.param('emailId')
  const existing = await c.env.DB.prepare('SELECT size FROM emails WHERE id = ? AND mailbox_id = ?')
    .bind(emailId, mailboxId)
    .first<{ size: number }>()
  if (!existing) return c.json({ code: 'not_found' }, 404)
  const del = await hardDeleteEmails(c.env.DB, mailboxId, [{ id: emailId, size: existing.size }])
  const snap = await getQuotaSnapshot(c.env.DB, mailboxId, c.env)
  return c.json({ ok: true, ...del, ...snap })
})

/** Bulk delete: by ids, oldest N, or all. */
app.post('/api/mailboxes/:id/emails/bulk-delete', sessionAuth, zValidator('json', bulkDeleteInput), async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  const input = c.req.valid('json')

  let targets: { id: string; size: number }[] = []

  if (input.mode === 'ids') {
    const ids = input.ids ?? []
    if (ids.length === 0) return c.json({ code: 'no_selection' }, 400)
    const placeholders = ids.map(() => '?').join(',')
    const { results } = await c.env.DB.prepare(
      `SELECT id, size FROM emails WHERE mailbox_id = ? AND id IN (${placeholders})`,
    )
      .bind(mailboxId, ...ids)
      .all<{ id: string; size: number }>()
    targets = results
  } else if (input.mode === 'oldest') {
    const count = input.count ?? 10
    const { results } = await c.env.DB.prepare(
      'SELECT id, size FROM emails WHERE mailbox_id = ? ORDER BY received_at ASC, id ASC LIMIT ?',
    )
      .bind(mailboxId, count)
      .all<{ id: string; size: number }>()
    targets = results
  } else {
    const { results } = await c.env.DB.prepare('SELECT id, size FROM emails WHERE mailbox_id = ?')
      .bind(mailboxId)
      .all<{ id: string; size: number }>()
    targets = results
  }

  const del = await hardDeleteEmails(c.env.DB, mailboxId, targets)
  const snap = await getQuotaSnapshot(c.env.DB, mailboxId, c.env)
  return c.json({ ...del, ...snap })
})

/** Patch star / folder / labels */
app.patch(
  '/api/mailboxes/:id/emails/:emailId',
  sessionAuth,
  zValidator('json', patchEmailInput),
  async (c) => {
    const mailboxId = c.get('mailboxId')
    if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
    const emailId = c.req.param('emailId')
    const input = c.req.valid('json')
    const existing = await c.env.DB.prepare(
      `SELECT ${EMAIL_DETAIL_COLS} FROM emails WHERE id = ? AND mailbox_id = ?`,
    )
      .bind(emailId, mailboxId)
      .first<EmailRow>()
    if (!existing) return c.json({ code: 'not_found' }, 404)

    const isStarred = input.isStarred !== undefined ? (input.isStarred ? 1 : 0) : existing.isStarred
    const folder = input.folder ?? existing.folder ?? 'inbox'
    const labels =
      input.labels !== undefined ? input.labels : existing.labelsJson ? JSON.parse(existing.labelsJson) : []
    await c.env.DB.prepare(
      'UPDATE emails SET is_starred = ?, folder = ?, labels_json = ? WHERE id = ? AND mailbox_id = ?',
    )
      .bind(isStarred, folder, labels.length ? JSON.stringify(labels) : null, emailId, mailboxId)
      .run()
    const snap = await getQuotaSnapshot(c.env.DB, mailboxId, c.env)
    return c.json({
      id: emailId,
      isStarred: isStarred === 1,
      folder,
      labels,
      ...snap,
    })
  },
)

/** Download reconstructed .eml */
app.get('/api/mailboxes/:id/emails/:emailId/eml', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  const email = await c.env.DB.prepare(
    `SELECT ${EMAIL_DETAIL_COLS} FROM emails WHERE id = ? AND mailbox_id = ?`,
  )
    .bind(c.req.param('emailId'), mailboxId)
    .first<EmailRow>()
  if (!email) return c.json({ code: 'not_found' }, 404)
  const mapped = mapEmail(email)
  const eml = buildEml({
    sender: mapped.sender,
    senderName: mapped.senderName,
    subject: mapped.subject,
    bodyText: mapped.bodyText,
    bodyHtml: mapped.bodyHtml,
    to: mapped.to,
    cc: mapped.cc,
    messageId: mapped.messageId,
    receivedAt: mapped.receivedAt,
    attachments: mapped.attachments,
  })
  const filename = `${(mapped.subject || 'mail').replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 40)}.eml`
  return new Response(eml, {
    headers: {
      'content-type': 'message/rfc822; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
})

/** Export mailbox as json or mbox */
app.get('/api/mailboxes/:id/export', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  const format = (c.req.query('format') ?? 'json').toLowerCase()
  const { results } = await c.env.DB.prepare(
    `SELECT ${EMAIL_DETAIL_COLS} FROM emails WHERE mailbox_id = ? ORDER BY received_at ASC, id ASC LIMIT 2000`,
  )
    .bind(mailboxId)
    .all<EmailRow>()

  if (format === 'mbox') {
    const messages = results.map((row) => {
      const m = mapEmail(row)
      return {
        sender: m.sender,
        receivedAt: m.receivedAt,
        eml: buildEml({
          sender: m.sender,
          senderName: m.senderName,
          subject: m.subject,
          bodyText: m.bodyText,
          bodyHtml: m.bodyHtml,
          to: m.to,
          cc: m.cc,
          messageId: m.messageId,
          receivedAt: m.receivedAt,
          attachments: m.attachments,
        }),
      }
    })
    const body = buildMbox(messages)
    return new Response(body, {
      headers: {
        'content-type': 'application/mbox',
        'content-disposition': 'attachment; filename="mailbox.mbox"',
      },
    })
  }

  return c.json({
    exportedAt: new Date().toISOString(),
    count: results.length,
    emails: results.map((r) => mapEmail(r)),
  })
})

/** Filters CRUD */
app.get('/api/mailboxes/:id/filters', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, match_field AS matchField, match_op AS matchOp, match_value AS matchValue,
      action, enabled, created_at AS createdAt FROM mail_filters WHERE mailbox_id = ? ORDER BY created_at DESC`,
  )
    .bind(mailboxId)
    .all()
  return c.json({
    filters: results.map((f) => ({
      ...f,
      enabled: Number((f as { enabled: number }).enabled) === 1,
    })),
  })
})

app.post('/api/mailboxes/:id/filters', sessionAuth, zValidator('json', filterInput), async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  const input = c.req.valid('json')
  if (input.action === 'label' && !input.name?.trim()) {
    return c.json({ code: 'label_name_required' }, 400)
  }
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  await c.env.DB.prepare(
    `INSERT INTO mail_filters (id, mailbox_id, name, match_field, match_op, match_value, action, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      mailboxId,
      input.name ?? '',
      input.matchField,
      input.matchOp,
      input.matchValue,
      input.action,
      input.enabled ? 1 : 0,
      createdAt,
    )
    .run()
  return c.json(
    {
      id,
      name: input.name ?? '',
      matchField: input.matchField,
      matchOp: input.matchOp,
      matchValue: input.matchValue,
      action: input.action,
      enabled: input.enabled,
      createdAt,
    },
    201,
  )
})

app.delete('/api/mailboxes/:id/filters/:filterId', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (!assertMailbox(c, c.req.param('id'))) return c.json({ code: 'forbidden' }, 403)
  const result = await c.env.DB.prepare('DELETE FROM mail_filters WHERE id = ? AND mailbox_id = ?')
    .bind(c.req.param('filterId'), mailboxId)
    .run()
  if (result.meta.changes === 0) return c.json({ code: 'not_found' }, 404)
  return c.body(null, 204)
})

/** Admin */
app.get('/api/admin/stats', adminAuth, async (c) => {
  const mailboxes = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM mailboxes').first<{ n: number }>()
  const emails = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM emails').first<{ n: number }>()
  const unread = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM emails WHERE is_read = 0').first<{ n: number }>()
  const sessions = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>()
  const blocked = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM blocked_prefixes').first<{ n: number }>()
  const size = await c.env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM emails').first<{ n: number }>()
  return c.json({
    mailboxes: mailboxes?.n ?? 0,
    emails: emails?.n ?? 0,
    unread: unread?.n ?? 0,
    sessions: sessions?.n ?? 0,
    blockedPrefixes: blocked?.n ?? 0,
    totalBytes: size?.n ?? 0,
  })
})

app.get('/api/admin/blocked-prefixes', adminAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT local_part AS localPart, reason, created_at AS createdAt FROM blocked_prefixes ORDER BY created_at DESC',
  ).all()
  return c.json({ prefixes: results })
})

app.post('/api/admin/blocked-prefixes', adminAuth, zValidator('json', blockPrefixInput), async (c) => {
  const { localPart: raw, reason } = c.req.valid('json')
  const localPart = raw.trim().toLowerCase()
  const createdAt = new Date().toISOString()
  try {
    await c.env.DB.prepare(
      'INSERT INTO blocked_prefixes (local_part, reason, created_at) VALUES (?, ?, ?)',
    )
      .bind(localPart, reason ?? null, createdAt)
      .run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ code: 'already_blocked' }, 409)
    }
    throw err
  }
  return c.json({ localPart, reason: reason ?? null, createdAt }, 201)
})

app.delete('/api/admin/blocked-prefixes/:localPart', adminAuth, async (c) => {
  const localPart = c.req.param('localPart').toLowerCase()
  const result = await c.env.DB.prepare('DELETE FROM blocked_prefixes WHERE local_part = ?')
    .bind(localPart)
    .run()
  if (result.meta.changes === 0) return c.json({ code: 'not_found' }, 404)
  return c.body(null, 204)
})

app.get('/api/admin/registrations', adminAuth, async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 200)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0)
  const { results } = await c.env.DB.prepare(
    'SELECT local_part AS localPart, device_id AS deviceId, ip, status, created_at AS createdAt FROM registrations ORDER BY created_at DESC LIMIT ? OFFSET ?',
  )
    .bind(limit, offset)
    .all()
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM registrations').first<{ n: number }>()
  return c.json({ registrations: results, total: total?.n ?? 0 })
})

app.post('/api/admin/mailboxes/:id/unbind', adminAuth, async (c) => {
  const result = await c.env.DB.prepare('UPDATE mailboxes SET device_id = NULL WHERE id = ?')
    .bind(c.req.param('id'))
    .run()
  if (result.meta.changes === 0) return c.json({ code: 'not_found' }, 404)
  return c.json({ ok: true })
})

function parseLocalPart(recipient: string | string[] | undefined, domain: string | undefined): string | null {
  const address = Array.isArray(recipient) ? recipient[0] : recipient
  if (!address) return null
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const mailDomain = address.slice(at + 1).toLowerCase()
  if (domain && mailDomain !== domain.toLowerCase()) return null
  return address.slice(0, at).toLowerCase()
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

async function handleEmail(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
  const reject = (reason: string, localPart?: string) => {
    log('warn', 'email.rejected', { localPart, reason, size: message.rawSize, from: message.from })
    message.setReject(reason)
  }

  const size = message.rawSize
  if (size > MAX_EMAIL_SIZE) {
    reject('邮件超过 1MB 大小限制。')
    return
  }

  const localPart = parseLocalPart(message.to, env.LEMONMAIL_DOMAIN)
  if (!localPart) {
    reject('收件地址无效。')
    return
  }

  const mailbox = await env.DB.prepare('SELECT id FROM mailboxes WHERE local_part = ?')
    .bind(localPart)
    .first<{ id: string }>()
  if (!mailbox) {
    reject('收件邮箱不存在。', localPart)
    return
  }

  const limit = quotaBytes(env)
  const reserve = await env.DB.prepare(
    'UPDATE mailboxes SET used_bytes = used_bytes + ? WHERE id = ? AND used_bytes + ? <= ?',
  )
    .bind(size, mailbox.id, size, limit)
    .run()
  if (reserve.meta.changes === 0) {
    reject('邮箱配额已满。', localPart)
    return
  }

  try {
    const parsed = await new PostalMime().parse(await readStream(message.raw))
    const sender = parsed.from?.address ?? ''
    const senderName = (parsed.from?.name ?? '').trim() || null
    const subject = parsed.subject ?? ''
    const bodyText = parsed.text ?? null
    const bodyHtml = parsed.html ?? null
    const to = formatAddrs(parsed.to as { address?: string; name?: string }[] | undefined)
    const cc = formatAddrs(parsed.cc as { address?: string; name?: string }[] | undefined)
    const messageId = parsed.messageId ?? null
    const attachments: AttachmentMeta[] = (parsed.attachments ?? []).map((a) => {
      const content = a.content
      let attSize = 0
      if (content instanceof Uint8Array) attSize = content.byteLength
      else if (content instanceof ArrayBuffer) attSize = content.byteLength
      else if (typeof content === 'string') attSize = content.length
      return {
        filename: a.filename || 'attachment',
        mimeType: a.mimeType || 'application/octet-stream',
        size: attSize,
      }
    })

    const filters = await loadFilters(env.DB, mailbox.id)
    const filterResult = applyFilters(filters, { sender, subject, bodyText })
    if (filterResult.drop) {
      await env.DB.prepare('UPDATE mailboxes SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?')
        .bind(size, mailbox.id)
        .run()
      log('info', 'email.dropped_by_filter', { localPart, size })
      return
    }

    const emailId = crypto.randomUUID()
    const receivedAt = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO emails (
        id, mailbox_id, sender, sender_name, subject, body_text, body_html, size, is_read, received_at,
        to_addrs, cc_addrs, message_id, attachments_json, is_starred, folder, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        emailId,
        mailbox.id,
        sender,
        senderName,
        subject,
        bodyText,
        bodyHtml,
        size,
        filterResult.isRead ? 1 : 0,
        receivedAt,
        to.length ? JSON.stringify(to) : null,
        cc.length ? JSON.stringify(cc) : null,
        messageId,
        attachments.length ? JSON.stringify(attachments) : null,
        filterResult.isStarred ? 1 : 0,
        filterResult.folder,
        filterResult.labels.length ? JSON.stringify(filterResult.labels) : null,
      )
      .run()

    try {
      await ftsIndex(env.DB, {
        id: emailId,
        mailboxId: mailbox.id,
        subject,
        sender,
        senderName,
        bodyText,
      })
    } catch (ftsErr) {
      log('error', 'email.fts_failed', { emailId, reason: ftsErr instanceof Error ? ftsErr.message : String(ftsErr) })
    }

    await notifyWebhook(env.MAIL_WEBHOOK_URL, {
      mailboxId: mailbox.id,
      localPart,
      emailId,
      sender,
      subject,
      size,
      receivedAt,
    })
    log('info', 'email.received', { localPart, emailId, sender, size, subject: subject.slice(0, 100) })
  } catch (err) {
    await env.DB.prepare('UPDATE mailboxes SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?')
      .bind(size, mailbox.id)
      .run()
    log('error', 'email.failed', { localPart, reason: err instanceof Error ? err.message : String(err) })
    reject('邮件处理失败。', localPart)
  }
}

async function cleanupExpiredSessions(db: D1Database): Promise<number> {
  const now = new Date().toISOString()
  const sessions = await db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now).run()
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(dayAgo).run()
  return sessions.meta.changes
}

export default {
  fetch: app.fetch,
  email: handleEmail,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const purgedSessions = await cleanupExpiredSessions(env.DB)
    const maxAge = parsePositiveInt(env.EMAIL_MAX_AGE_DAYS, 0)
    let purgedEmails = 0
    if (maxAge > 0) {
      purgedEmails = await purgeOldEmails(env.DB, maxAge)
    }
    log('info', 'cron.run', { purgedSessions, maxAgeDays: maxAge, purgedEmails })
  },
}

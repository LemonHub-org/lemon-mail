import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import PostalMime from 'postal-mime'
import { z } from 'zod'
import type { MiddlewareHandler } from 'hono'
import type { D1Database, ForwardableEmailMessage, ExecutionContext, ReadableStream } from '@cloudflare/workers-types'

type Env = {
  DB: D1Database
  LEMONMAIL_DOMAIN?: string
  MAILBOX_QUOTA_MB?: string
}

const MAX_EMAIL_SIZE = 1024 * 1024
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PBKDF2_ITERATIONS = 100_000

type MailboxRow = { id: string; localPart: string; passwordSalt: string; passwordHash: string; createdAt: string }
type EmailRow = { id: string; sender: string; subject: string; bodyText: string | null; bodyHtml: string | null; size: number; isRead: number; receivedAt: string }

const mailboxInput = z.object({
  localPart: z.string().trim().min(1, '请输入邮箱前缀').max(64).regex(/^[a-zA-Z0-9._+-]+$/, '前缀只能包含字母、数字和 . _ + -'),
  password: z.string().min(8, '密码至少 8 位').max(128, '密码过长'),
})

const loginInput = z.object({
  password: z.string().min(1, '请输入密码'),
})

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256)
  return toHex(new Uint8Array(bits))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const app = new Hono<{ Bindings: Env; Variables: { mailboxId: string } }>()

app.use('/api/*', cors({ origin: 'https://mail.lemonhub.net' }))

const sessionAuth: MiddlewareHandler<{ Bindings: Env; Variables: { mailboxId: string } }> = async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return c.json({ message: '请先登录。' }, 401)
  const session = await c.env.DB.prepare('SELECT mailbox_id AS mailboxId, expires_at AS expiresAt FROM auth_sessions WHERE token = ?').bind(token).first<{ mailboxId: string; expiresAt: string }>()
  if (!session || Date.parse(session.expiresAt) < Date.now()) return c.json({ message: '登录已过期，请重新登录。' }, 401)
  c.set('mailboxId', session.mailboxId)
  return next()
}

app.get('/api/health', (c) => c.json({ ok: true, domain: c.env.LEMONMAIL_DOMAIN ?? 'lemonhub.net' }))

app.get('/api/mailboxes', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, local_part AS localPart, created_at AS createdAt FROM mailboxes ORDER BY created_at DESC, id DESC'
  ).all()
  return c.json(results)
})

app.post('/api/mailboxes', zValidator('json', mailboxInput), async (c) => {
  const input = c.req.valid('json')
  const localPart = input.localPart.toLowerCase()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const passwordHash = await hashPassword(input.password, salt)
  const mailbox = { id: crypto.randomUUID(), localPart, createdAt: new Date().toISOString() }
  try {
    await c.env.DB.prepare('INSERT INTO mailboxes (id, local_part, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(mailbox.id, localPart, toHex(salt), passwordHash, mailbox.createdAt)
      .run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ message: '这个邮箱地址已经存在。' }, 409)
    }
    throw err
  }
  return c.json(mailbox, 201)
})

app.delete('/api/mailboxes/:id', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM emails WHERE mailbox_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM auth_sessions WHERE mailbox_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM mailboxes WHERE id = ?').bind(id),
  ])
  if (result[2].meta.changes === 0) return c.json({ message: '未找到邮箱地址。' }, 404)
  return c.body(null, 204)
})

app.post('/api/mailboxes/:id/login', zValidator('json', loginInput), async (c) => {
  const id = c.req.param('id')
  const { password } = c.req.valid('json')
  const row = await c.env.DB.prepare(
    'SELECT id, local_part AS localPart, password_salt AS passwordSalt, password_hash AS passwordHash, created_at AS createdAt FROM mailboxes WHERE id = ?'
  ).bind(id).first<MailboxRow>()
  if (!row || !row.passwordSalt || !row.passwordHash) return c.json({ message: '邮箱不存在或未设置密码。' }, 401)
  const salt = Uint8Array.from(row.passwordSalt.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  const expected = await hashPassword(password, salt)
  if (!constantTimeEqual(expected, row.passwordHash)) return c.json({ message: '密码错误。' }, 401)
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const now = new Date()
  await c.env.DB.prepare('INSERT INTO auth_sessions (token, mailbox_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, row.id, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString())
    .run()
  return c.json({ token, expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() })
})

app.get('/api/mailboxes/:id/emails', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  const id = c.req.param('id')
  if (id !== mailboxId) return c.json({ message: '无权访问该邮箱。' }, 403)
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0)
  const { results } = await c.env.DB.prepare(
    'SELECT id, sender, subject, size, is_read AS isRead, received_at AS receivedAt FROM emails WHERE mailbox_id = ? ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?'
  ).bind(mailboxId, limit, offset).all<EmailRow>()
  const { results: quotaRows } = await c.env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM emails WHERE mailbox_id = ?').bind(mailboxId).all<{ used: number }>()
  const { results: totalRows } = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM emails WHERE mailbox_id = ?').bind(mailboxId).all<{ total: number }>()
  return c.json({
    emails: results.map((e) => ({ ...e, isRead: e.isRead === 1 })),
    quota: { used: quotaRows[0].used, limit: (parseInt(c.env.MAILBOX_QUOTA_MB ?? '10', 10) || 10) * 1024 * 1024 },
    total: totalRows[0].total,
  })
})

app.get('/api/mailboxes/:id/emails/:emailId', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (c.req.param('id') !== mailboxId) return c.json({ message: '无权访问该邮箱。' }, 403)
  const email = await c.env.DB.prepare(
    'SELECT id, sender, subject, body_text AS bodyText, body_html AS bodyHtml, size, is_read AS isRead, received_at AS receivedAt FROM emails WHERE id = ? AND mailbox_id = ?'
  ).bind(c.req.param('emailId'), mailboxId).first<EmailRow>()
  if (!email) return c.json({ message: '未找到该邮件。' }, 404)
  await c.env.DB.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').bind(email.id).run()
  return c.json({ ...email, isRead: true })
})

app.delete('/api/mailboxes/:id/emails/:emailId', sessionAuth, async (c) => {
  const mailboxId = c.get('mailboxId')
  if (c.req.param('id') !== mailboxId) return c.json({ message: '无权访问该邮箱。' }, 403)
  const result = await c.env.DB.prepare('DELETE FROM emails WHERE id = ? AND mailbox_id = ?').bind(c.req.param('emailId'), mailboxId).run()
  if (result.meta.changes === 0) return c.json({ message: '未找到该邮件。' }, 404)
  return c.body(null, 204)
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
  const reject = (reason: string) => {
    message.setReject(reason)
    throw new Error(reason)
  }

  const size = message.rawSize
  if (size > MAX_EMAIL_SIZE) return reject('邮件超过 1MB 大小限制。')

  const localPart = parseLocalPart(message.to, env.LEMONMAIL_DOMAIN)
  if (!localPart) return reject('收件地址无效。')

  const mailbox = await env.DB.prepare('SELECT id FROM mailboxes WHERE local_part = ?').bind(localPart).first<{ id: string }>()
  if (!mailbox) return reject('收件邮箱不存在。')

  const quotaBytes = (parseInt(env.MAILBOX_QUOTA_MB ?? '10', 10) || 10) * 1024 * 1024
  const usage = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM emails WHERE mailbox_id = ?').bind(mailbox.id).first<{ used: number }>()
  if (usage && usage.used + size > quotaBytes) return reject('邮箱配额已满。')

  const parsed = await new PostalMime().parse(await readStream(message.raw))
  const sender = parsed.from?.address ?? ''
  await env.DB.prepare(
    'INSERT INTO emails (id, mailbox_id, sender, subject, body_text, body_html, size, is_read, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
  )
    .bind(crypto.randomUUID(), mailbox.id, sender, parsed.subject ?? '', parsed.text ?? null, parsed.html ?? null, size, new Date().toISOString())
    .run()
}

export default { fetch: app.fetch, email: handleEmail }

/**
 * P2 helpers: FTS, filters, .eml rebuild, export, retention (no R2 / no send).
 */
import type { D1Database } from '@cloudflare/workers-types'

export type Folder = 'inbox' | 'archive' | 'trash'
export type AttachmentMeta = { filename: string; mimeType: string; size: number }
export type AddrMeta = { name: string; address: string }

export type FilterRow = {
  id: string
  mailboxId: string
  name: string
  matchField: string
  matchOp: string
  matchValue: string
  action: string
  enabled: number
  createdAt: string
}

export type FilterAction = {
  drop: boolean
  isStarred: boolean
  folder: Folder
  isRead: boolean
  labels: string[]
}

export function encodeRfc2047(text: string): string {
  if (!text) return ''
  if (/^[\x20-\x7E]*$/.test(text)) return text
  const b64 = btoa(unescape(encodeURIComponent(text)))
  return `=?UTF-8?B?${b64}?=`
}

export function formatAddrHeader(a: AddrMeta): string {
  if (a.name) return `${encodeRfc2047(a.name)} <${a.address}>`
  return a.address
}

/** Rebuild a minimal RFC822 message from stored fields (no original raw / no R2). */
export function buildEml(input: {
  sender: string
  senderName: string | null
  subject: string
  bodyText: string | null
  bodyHtml: string | null
  to: AddrMeta[]
  cc: AddrMeta[]
  messageId: string | null
  receivedAt: string
  attachments: AttachmentMeta[]
}): string {
  const from = input.senderName
    ? formatAddrHeader({ name: input.senderName, address: input.sender })
    : input.sender || 'unknown@invalid'
  const toLine = input.to.length ? input.to.map(formatAddrHeader).join(', ') : 'undisclosed-recipients:;'
  const date = new Date(input.receivedAt).toUTCString()
  const subject = encodeRfc2047(input.subject || '')
  const lines: string[] = [
    `From: ${from}`,
    `To: ${toLine}`,
  ]
  if (input.cc.length) lines.push(`Cc: ${input.cc.map(formatAddrHeader).join(', ')}`)
  if (input.messageId) lines.push(`Message-ID: ${input.messageId}`)
  lines.push(`Date: ${date}`, `Subject: ${subject}`, 'MIME-Version: 1.0')

  const text = input.bodyText || ''
  const html = input.bodyHtml || ''
  const attNote =
    input.attachments.length > 0
      ? `\n\n[附件元数据 only — 正文未托管]\n${input.attachments.map((a) => `- ${a.filename} (${a.mimeType}, ${a.size} B)`).join('\n')}`
      : ''

  if (html && text) {
    const boundary = `lm-${crypto.randomUUID().replace(/-/g, '')}`
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, '')
    lines.push(`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text + attNote, '')
    lines.push(`--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', html, '')
    lines.push(`--${boundary}--`, '')
  } else if (html) {
    lines.push('Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', html)
  } else {
    lines.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text + attNote)
  }
  return lines.join('\r\n')
}

export function buildMbox(messages: { eml: string; receivedAt: string; sender: string }[]): string {
  return messages
    .map((m) => {
      const from = m.sender || 'unknown@invalid'
      const date = new Date(m.receivedAt).toUTCString()
      const body = m.eml.replace(/^From /gm, '>From ')
      return `From ${from} ${date}\r\n${body}\r\n`
    })
    .join('\r\n')
}

/** Escape user query for FTS5 MATCH (prefix tokens). */
export function ftsQuery(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return ''
  return tokens.map((t) => `"${t}"*`).join(' ')
}

export async function ftsIndex(
  db: D1Database,
  row: {
    id: string
    mailboxId: string
    subject: string
    sender: string
    senderName: string | null
    bodyText: string | null
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO emails_fts (email_id, mailbox_id, subject, sender, sender_name, body_text) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(row.id, row.mailboxId, row.subject, row.sender, row.senderName ?? '', row.bodyText ?? '')
    .run()
}

export async function ftsRemove(db: D1Database, emailIds: string[]): Promise<void> {
  if (emailIds.length === 0) return
  for (let i = 0; i < emailIds.length; i += 40) {
    const chunk = emailIds.slice(i, i + 40)
    const ph = chunk.map(() => '?').join(',')
    await db.prepare(`DELETE FROM emails_fts WHERE email_id IN (${ph})`).bind(...chunk).run()
  }
}

export async function loadFilters(db: D1Database, mailboxId: string): Promise<FilterRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, mailbox_id AS mailboxId, name, match_field AS matchField, match_op AS matchOp,
        match_value AS matchValue, action, enabled, created_at AS createdAt
       FROM mail_filters WHERE mailbox_id = ? AND enabled = 1`,
    )
    .bind(mailboxId)
    .all<FilterRow>()
  return results
}

export function applyFilters(
  filters: FilterRow[],
  mail: { sender: string; subject: string; bodyText: string | null },
): FilterAction {
  const result: FilterAction = {
    drop: false,
    isStarred: false,
    folder: 'inbox',
    isRead: false,
    labels: [],
  }
  for (const f of filters) {
    const hay =
      f.matchField === 'sender'
        ? mail.sender
        : f.matchField === 'body'
          ? mail.bodyText ?? ''
          : mail.subject
    const needle = f.matchValue
    const hit =
      f.matchOp === 'equals'
        ? hay.toLowerCase() === needle.toLowerCase()
        : hay.toLowerCase().includes(needle.toLowerCase())
    if (!hit) continue
    switch (f.action) {
      case 'delete':
        result.drop = true
        return result
      case 'star':
        result.isStarred = true
        break
      case 'archive':
        result.folder = 'archive'
        break
      case 'mark_read':
        result.isRead = true
        break
      case 'label':
        if (f.name && !result.labels.includes(f.name)) result.labels.push(f.name)
        break
      default:
        break
    }
  }
  return result
}

export async function hardDeleteEmails(
  db: D1Database,
  mailboxId: string,
  targets: { id: string; size: number }[],
): Promise<{ deleted: number; freed: number }> {
  if (targets.length === 0) return { deleted: 0, freed: 0 }
  const freed = targets.reduce((s, t) => s + t.size, 0)
  const ids = targets.map((t) => t.id)
  await ftsRemove(db, ids)
  for (let i = 0; i < targets.length; i += 40) {
    const chunk = targets.slice(i, i + 40)
    const stmts = chunk.map((t) =>
      db.prepare('DELETE FROM emails WHERE id = ? AND mailbox_id = ?').bind(t.id, mailboxId),
    )
    await db.batch(stmts)
  }
  await db
    .prepare('UPDATE mailboxes SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?')
    .bind(freed, mailboxId)
    .run()
  const sumRow = await db
    .prepare('SELECT COALESCE(SUM(size), 0) AS used FROM emails WHERE mailbox_id = ?')
    .bind(mailboxId)
    .first<{ used: number }>()
  if (sumRow) {
    await db.prepare('UPDATE mailboxes SET used_bytes = ? WHERE id = ?').bind(sumRow.used, mailboxId).run()
  }
  return { deleted: targets.length, freed }
}

export async function purgeOldEmails(db: D1Database, maxAgeDays: number): Promise<number> {
  if (maxAgeDays <= 0) return 0
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
  const { results } = await db
    .prepare('SELECT id, mailbox_id AS mailboxId, size FROM emails WHERE received_at < ? LIMIT 500')
    .bind(cutoff)
    .all<{ id: string; mailboxId: string; size: number }>()
  if (results.length === 0) return 0

  // Group by mailbox for quota updates
  const byMb = new Map<string, { id: string; size: number }[]>()
  for (const r of results) {
    const list = byMb.get(r.mailboxId) ?? []
    list.push({ id: r.id, size: r.size })
    byMb.set(r.mailboxId, list)
  }
  let total = 0
  for (const [mailboxId, targets] of byMb) {
    const res = await hardDeleteEmails(db, mailboxId, targets)
    total += res.deleted
  }
  return total
}

export async function notifyWebhook(
  url: string | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'email.received', ...payload }),
    })
  } catch (err) {
    console.error('webhook failed', err)
  }
}

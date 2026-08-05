import { serve } from '@hono/node-server'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

type Mailbox = { id: string; localPart: string; destination: string; createdAt: string }

const mailboxInput = z.object({
  localPart: z.string().trim().min(1, '请输入邮箱前缀').max(64).regex(/^[a-zA-Z0-9._+-]+$/, '前缀只能包含字母、数字和 . _ + -'),
  destination: z.string().trim().email('请输入有效的转发邮箱'),
})

const mailboxes: Mailbox[] = [
  { id: '1', localPart: 'hello', destination: 'you@example.com', createdAt: '2026-08-05T00:00:00.000Z' },
  { id: '2', localPart: 'projects', destination: 'you@example.com', createdAt: '2026-08-05T00:00:00.000Z' },
]

const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true, domain: 'lemonhub.net' }))
app.get('/api/mailboxes', (c) => c.json(mailboxes))
app.post('/api/mailboxes', zValidator('json', mailboxInput), (c) => {
  const input = c.req.valid('json')
  const localPart = input.localPart.toLowerCase()
  if (mailboxes.some((mailbox) => mailbox.localPart === localPart)) {
    return c.json({ message: '这个邮箱地址已经存在。' }, 409)
  }
  const mailbox: Mailbox = { id: crypto.randomUUID(), localPart, destination: input.destination, createdAt: new Date().toISOString() }
  mailboxes.push(mailbox)
  return c.json(mailbox, 201)
})
app.delete('/api/mailboxes/:id', (c) => {
  const index = mailboxes.findIndex((mailbox) => mailbox.id === c.req.param('id'))
  if (index < 0) return c.json({ message: '未找到邮箱地址。' }, 404)
  mailboxes.splice(index, 1)
  return c.body(null, 204)
})

serve({ fetch: app.fetch, port: 8787 }, (info) => console.log(`Lemon Mail API listening on http://localhost:${info.port}`))

import { describe, expect, it } from 'vitest'
import worker from '../server/worker'
import { MiniD1 } from './helpers/mini-d1'

type Env = {
  DB: MiniD1
  LEMONMAIL_DOMAIN?: string
  MAILBOX_QUOTA_MB?: string
  TURNSTILE_SECRET?: string
  ADMIN_TOKEN?: string
  INVITE_CODE?: string
  MAILBOX_MAX_TOTAL?: string
  MAILBOX_CREATE_PER_IP_HOUR?: string
  LOGIN_PER_IP_WINDOW?: string
  LOGIN_PER_ADDR_WINDOW?: string
}

function makeEnv(): { env: Env; db: MiniD1 } {
  const db = new MiniD1()
  return {
    db,
    env: {
      DB: db as never,
      LEMONMAIL_DOMAIN: 'lemonhub.net',
      MAILBOX_QUOTA_MB: '10',
      MAILBOX_CREATE_PER_IP_HOUR: '100',
    },
  }
}

function call(env: Env, path: string, init?: RequestInit, extra?: { ip?: string; deviceId?: string }) {
  const headers = new Headers(init?.headers)
  if (extra?.ip) headers.set('cf-connecting-ip', extra.ip)
  if (extra?.deviceId) headers.set('device-id', extra.deviceId)
  return worker.fetch(new Request(`https://api.lemonhub.net${path}`, { ...init, headers }), env)
}

async function createMailbox(env: Env, localPart: string, password = 'password123', opts?: { ip?: string; deviceId?: string }): Promise<{ id: string; token: string }> {
  const res = await call(env, '/api/mailboxes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localPart, password }),
  }, opts)
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; token: string }
}

describe('health', () => {
  it('返回基础信息', async () => {
    const { env } = makeEnv()
    const res = await call(env, '/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, domain: 'lemonhub.net', turnstileRequired: false })
  })
})

describe('创建邮箱', () => {
  it('成功创建（返回 token + 写审计）', async () => {
    const { env, db } = makeEnv()
    const res = await call(env, '/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'hello', password: 'password123' }),
    }, { ip: '1.1.1.1', deviceId: 'dev-1' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ localPart: 'hello' })
    expect(typeof body.token).toBe('string')
    const regs = db.tables.get('registrations') ?? []
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({ local_part: 'hello', device_id: 'dev-1', ip: '1.1.1.1', status: 'accepted' })
  })

  it('密码少于 8 位拒绝 400', async () => {
    const { env } = makeEnv()
    const res = await call(env, '/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'hello', password: 'short' }),
    })
    expect(res.status).toBe(400)
  })

  it('重复前缀 409（大小写不敏感）', async () => {
    const { env } = makeEnv()
    await createMailbox(env, 'hello', 'password123', { ip: '1.1.1.1' })
    const res = await call(env, '/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'HELLO', password: 'password123' }),
    })
    expect(res.status).toBe(409)
    expect((await res.json())).toMatchObject({ code: 'mailbox_exists' })
  })

  it('非法前缀 400', async () => {
    const { env } = makeEnv()
    const res = await call(env, '/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'a', password: 'password123' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('反滥用（一人一邮箱）', () => {
  it('R1：同一 device_id 已有邮箱 → 409 abuse.device_exists', async () => {
    const { env, db } = makeEnv()
    await createMailbox(env, 'first1', 'password123', { ip: '1.1.1.1', deviceId: 'dev-x' })
    const res = await call(env, '/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'second', password: 'password123' }),
    }, { ip: '2.2.2.2', deviceId: 'dev-x' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'abuse.device_exists' })
    const regs = db.tables.get('registrations') ?? []
    expect(regs.some((r) => r.status === 'rejected_device' && r.local_part === 'second')).toBe(true)
  })

  it('R2：无指纹同 IP 第 4 个创建 → 409 abuse.ip_limit', async () => {
    const { env, db } = makeEnv()
    await createMailbox(env, 'aaa1', 'password123', { ip: '9.9.9.9' })
    await createMailbox(env, 'aaa2', 'password123', { ip: '9.9.9.9' })
    await createMailbox(env, 'aaa3', 'password123', { ip: '9.9.9.9' })
    const res = await call(env, '/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'aaa4', password: 'password123' }),
    }, { ip: '9.9.9.9' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'abuse.ip_limit' })
    expect(db.tables.get('registrations')?.some((r) => r.status === 'rejected_ip' && r.local_part === 'aaa4')).toBe(true)
  })

  it('R3：同 IP ≥8（即使带指纹）→ 409 abuse.ip_limit', async () => {
    const { env } = makeEnv()
    for (let i = 1; i <= 8; i++) {
      await createMailbox(env, `bbb${i}`, 'password123', { ip: '8.8.8.8', deviceId: `dev-${i}` })
    }
    const res = await call(env, '/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'bbb9', password: 'password123' }),
    }, { ip: '8.8.8.8', deviceId: 'dev-9' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'abuse.ip_limit' })
  })

  it('不同 IP 不同设备可以创建多个', async () => {
    const { env } = makeEnv()
    await createMailbox(env, 'ccc1', 'password123', { ip: '1.1.1.1', deviceId: 'dev-1' })
    const res = await call(env, '/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'ccc2', password: 'password123' }),
    }, { ip: '2.2.2.2', deviceId: 'dev-2' })
    expect(res.status).toBe(201)
  })
})

describe('登录与鉴权', () => {
  it('错误密码 401，正确密码返回 token', async () => {
    const { env } = makeEnv()
    const mb = await createMailbox(env, 'login', 'password123', { ip: '1.1.1.1' })
    const bad = await call(env, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'login', password: 'wrong' }),
    })
    expect(bad.status).toBe(401)
    const good = await call(env, '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: 'login', password: 'password123' }),
    })
    expect(good.status).toBe(200)
    const body = await good.json()
    expect(body.mailbox.id).toBe(mb.id)
    expect(typeof body.token).toBe('string')
  })

  it('无 token 访问邮件 401；错误 token 401', async () => {
    const { env } = makeEnv()
    const mb = await createMailbox(env, 'auth', 'password123', { ip: '1.1.1.1' })
    const noAuth = await call(env, `/api/mailboxes/${mb.id}/emails`)
    expect(noAuth.status).toBe(401)
    const badAuth = await call(env, `/api/mailboxes/${mb.id}/emails`, { headers: { authorization: 'Bearer invalid' } })
    expect(badAuth.status).toBe(401)
  })

  it('越权：A 的 token 访问 B 的邮箱 → 403', async () => {
    const { env } = makeEnv()
    const a = await createMailbox(env, 'owner-a', 'password123', { ip: '1.1.1.1', deviceId: 'da' })
    const b = await createMailbox(env, 'owner-b', 'password123', { ip: '2.2.2.2', deviceId: 'db' })
    const res = await call(env, `/api/mailboxes/${b.id}/emails`, { headers: { authorization: `Bearer ${a.token}` } })
    expect(res.status).toBe(403)
  })

  it('登出后 token 失效', async () => {
    const { env } = makeEnv()
    const mb = await createMailbox(env, 'logout', 'password123', { ip: '1.1.1.1' })
    const out = await call(env, '/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${mb.token}` } })
    expect(out.status).toBe(204)
    const after = await call(env, `/api/mailboxes/${mb.id}/emails`, { headers: { authorization: `Bearer ${mb.token}` } })
    expect(after.status).toBe(401)
  })
})

describe('邮件', () => {
  it('空收件箱返回配额 0', async () => {
    const { env } = makeEnv()
    const mb = await createMailbox(env, 'inbox', 'password123', { ip: '1.1.1.1' })
    const res = await call(env, `/api/mailboxes/${mb.id}/emails`, { headers: { authorization: `Bearer ${mb.token}` } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.emails).toEqual([])
    expect(body.quota).toEqual({ used: 0, limit: 10 * 1024 * 1024 })
  })

  it('带数据时列表/详情/已读/删除完整流程', async () => {
    const { env, db } = makeEnv()
    const mb = await createMailbox(env, 'flow', 'password123', { ip: '1.1.1.1' })
    db.seed('emails', [
      { id: 'e1', mailbox_id: mb.id, sender: 'a@x.com', subject: 'Hi', body_text: 'hello', body_html: null, size: 100, is_read: 0, folder: 'inbox', received_at: '2026-08-06T00:00:00.000Z' },
      { id: 'e2', mailbox_id: mb.id, sender: 'b@x.com', subject: 'Yo', body_text: null, body_html: '<p>yo</p>', size: 200, is_read: 1, folder: 'inbox', received_at: '2026-08-06T01:00:00.000Z' },
    ])
    const created = (db.tables.get('mailboxes') ?? []).map((r) => (r.id === mb.id ? { ...r, used_bytes: 300 } : r))
    db.seed('mailboxes', created)

    const list = await call(env, `/api/mailboxes/${mb.id}/emails`, { headers: { authorization: `Bearer ${mb.token}` } })
    const listBody = await list.json()
    expect(listBody.emails).toHaveLength(2)
    expect(listBody.quota.used).toBe(300)
    expect(listBody.unread).toBe(1)

    const detail = await call(env, `/api/mailboxes/${mb.id}/emails/e1`, { headers: { authorization: `Bearer ${mb.token}` } })
    const detailBody = await detail.json()
    expect(detailBody).toMatchObject({ id: 'e1', subject: 'Hi', isRead: true })

    const del = await call(env, `/api/mailboxes/${mb.id}/emails/e1`, { method: 'DELETE', headers: { authorization: `Bearer ${mb.token}` } })
    expect(del.status).toBe(200)

    const after = await call(env, `/api/mailboxes/${mb.id}/emails`, { headers: { authorization: `Bearer ${mb.token}` } })
    const afterBody = await after.json()
    expect(afterBody.emails).toHaveLength(1)
    expect(afterBody.quota.used).toBe(200)
  })
})

describe('admin', () => {
  it('未配置 ADMIN_TOKEN 时 503；错误 token 401', async () => {
    const { env } = makeEnv()
    const disabled = await call(env, '/api/admin/stats')
    expect(disabled.status).toBe(503)
    env.ADMIN_TOKEN = 'secret-token'
    const bad = await call(env, '/api/admin/stats', { headers: { authorization: 'Bearer nope' } })
    expect(bad.status).toBe(401)
  })

  it('审计列表 + 解绑设备', async () => {
    const { env, db } = makeEnv()
    env.ADMIN_TOKEN = 'secret-token'
    await createMailbox(env, 'admin1', 'password123', { ip: '1.1.1.1', deviceId: 'dev-a' })
    db.seed('mailboxes', db.tables.get('mailboxes') ?? [])

    const list = await call(env, '/api/admin/registrations', { headers: { authorization: 'Bearer secret-token' } })
    expect(list.status).toBe(200)
    const listBody = await list.json()
    expect(listBody.total).toBe(1)
    expect(listBody.registrations[0]).toMatchObject({ localPart: 'admin1', deviceId: 'dev-a' })

    const unbind = await call(env, `/api/admin/mailboxes/${listBody.registrations[0].mailboxId ?? 'x'}/unbind`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret-token' },
    })
    expect(unbind.status).toBe(404)
  })
})

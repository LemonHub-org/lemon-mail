// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { broadcastTabEvent, parseTabEvent } from '../src/tabs'
import type { TabEvent } from '../src/tabs'

describe('tabs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('broadcast 写入 lm-event 且 at 唯一', () => {
    broadcastTabEvent({ type: 'inbox-changed', mailboxId: 'm1' })
    const first = parseTabEvent(localStorage.getItem('lm-event'))
    broadcastTabEvent({ type: 'inbox-changed', mailboxId: 'm1' })
    const second = parseTabEvent(localStorage.getItem('lm-event'))
    expect(first?.type).toBe('inbox-changed')
    expect(first?.mailboxId).toBe('m1')
    expect(second?.at).toBeGreaterThanOrEqual(first!.at)
  })

  it('parseTabEvent 拒绝畸形数据', () => {
    expect(parseTabEvent(null)).toBeNull()
    expect(parseTabEvent('not-json')).toBeNull()
    expect(parseTabEvent('{"type":"logout"}')).toBeNull()
    expect(parseTabEvent('{"type":123,"mailboxId":"m"}')).toBeNull()
  })

  it('三种事件类型往返', () => {
    for (const type of ['inbox-changed', 'logout', 'mailbox-deleted'] as const) {
      broadcastTabEvent({ type, mailboxId: 'm9' })
      const ev = parseTabEvent(localStorage.getItem('lm-event')) as TabEvent
      expect(ev.type).toBe(type)
      expect(ev.mailboxId).toBe('m9')
    }
  })
})

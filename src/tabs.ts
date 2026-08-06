const EVENT_KEY = 'lm-event'

export type TabEvent = {
  type: 'inbox-changed' | 'logout' | 'mailbox-deleted'
  mailboxId: string
  at: number
}

/**
 * Cross-tab broadcast via localStorage. Writing the key triggers the
 * `storage` event in every OTHER tab of the same origin (never in this one).
 * `at` keeps every write unique so repeated same-type events still fire.
 */
export function broadcastTabEvent(ev: Omit<TabEvent, 'at'>): void {
  try {
    localStorage.setItem(EVENT_KEY, JSON.stringify({ ...ev, at: Date.now() }))
  } catch {
    /* ignore */
  }
}

export function parseTabEvent(raw: string | null): TabEvent | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as TabEvent
    if (typeof parsed?.type === 'string' && typeof parsed?.mailboxId === 'string') return parsed
    return null
  } catch {
    return null
  }
}

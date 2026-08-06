import { gt } from '../i18n'
import { i18n } from '../i18n'

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return gt('size.mb', { n: (bytes / 1024 / 1024).toFixed(1) })
  if (bytes >= 1024) return gt('size.kb', { n: Math.round(bytes / 1024) })
  return gt('size.bytes', { n: bytes })
}

export function formatTime(iso: string): string {
  const locale = i18n.global.locale.value
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return gt('time.justNow')
  if (diffMin < 60) return gt('time.minutesAgo', { n: diffMin })
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return gt('time.yesterday', {
      time: date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatFullTime(iso: string): string {
  return new Date(iso).toLocaleString(i18n.global.locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function senderName(sender: string): string {
  if (!sender) return gt('sender.unknown')
  const match = sender.match(/^(.+?)\s*<.+>$/)
  if (match) return match[1].replace(/^["']|["']$/g, '').trim() || sender
  return sender
}

export function displayName(email: { sender: string; senderName?: string | null }): string {
  if (email.senderName?.trim()) return email.senderName.trim()
  return senderName(email.sender)
}

export function senderInitial(email: { sender: string; senderName?: string | null } | string): string {
  const name = typeof email === 'string' ? senderName(email) : displayName(email)
  const ch = name.charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

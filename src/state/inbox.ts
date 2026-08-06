import { computed, ref } from 'vue'
import { gt } from '../i18n'
import { broadcastTabEvent } from '../tabs'
import { view } from './app'
import {
  ApiError,
  apiBase,
  apiErrorMessage,
  clearToken,
  fullAddress,
  mailbox,
  readErrorCode,
  removeRecent,
  token,
} from './session'

export type EmailSummary = {
  id: string
  sender: string
  senderName?: string | null
  subject: string
  size: number
  isRead: boolean
  isStarred?: boolean
  folder?: string
  labels?: string[]
  receivedAt: string
  attachmentCount?: number
}
export type EmailDetail = EmailSummary & {
  bodyText: string | null
  bodyHtml: string | null
  to?: { name: string; address: string }[]
  cc?: { name: string; address: string }[]
  messageId?: string | null
  attachments?: { filename: string; mimeType: string; size: number }[]
}
export type Folder = 'inbox' | 'unread' | 'starred' | 'archive' | 'trash'

const PAGE_SIZE = 40

export const emails = ref<EmailSummary[]>([])
export const selected = ref<EmailDetail | null>(null)
export const selectedId = ref<string | null>(null)
export const inboxLoading = ref(false)
export const detailLoading = ref(false)
export const inboxError = ref('')
export const quotaUsed = ref(0)
export const quotaLimit = ref(10 * 1024 * 1024)
export const total = ref(0)
export const unread = ref(0)
export const folderCounts = ref<Record<string, number>>({ inbox: 0, archive: 0, trash: 0 })
export const starredCount = ref(0)
export const matchedTotal = ref(0)
export const folder = ref<Folder>('inbox')
export const searchQuery = ref('')
export const searchActive = ref('')
export const bodyMode = ref<'html' | 'text'>('html')
export const mobilePane = ref<'list' | 'detail'>('list')
export const sidebarOpen = ref(false)
export const refreshing = ref(false)
export const loadingMore = ref(false)
export const hasMore = ref(false)
export const copyHint = ref('')
export const deletingMailbox = ref(false)

export const quotaPercent = computed(() => Math.min(Math.round((quotaUsed.value / quotaLimit.value) * 100), 100))
export const quotaOver = computed(() => quotaPercent.value >= 80)
export const filteredEmails = computed(() => emails.value)

export async function enterInbox() {
  view.value = 'inbox'
  selected.value = null
  selectedId.value = null
  mobilePane.value = 'list'
  folder.value = 'inbox'
  searchQuery.value = ''
  searchActive.value = ''
  sidebarOpen.value = false
  await loadInbox(true)
}

export async function loadInbox(reset = false, silent = false) {
  if (!mailbox.value) return
  if (reset && !silent) {
    inboxLoading.value = true
    emails.value = []
  }
  inboxError.value = ''
  try {
    const offset = reset ? 0 : emails.value.length
    const folderParam =
      folder.value === 'unread' ? 'inbox' : folder.value === 'starred' ? 'starred' : folder.value
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      folder: folderParam,
    })
    if (folder.value === 'unread') params.set('unread', '1')
    if (searchActive.value) params.set('q', searchActive.value)
    const response = await fetch(
      `${apiBase}/api/mailboxes/${mailbox.value.id}/emails?${params}`,
      { headers: { authorization: `Bearer ${token.value}` } },
    )
    const payload = await response.json()
    if (!response.ok) throw new ApiError(await readErrorCode(response))
    const next = payload.emails as EmailSummary[]
    emails.value = reset ? next : [...emails.value, ...next]
    quotaUsed.value = payload.quota.used
    quotaLimit.value = payload.quota.limit
    total.value = payload.total
    unread.value = payload.unread ?? 0
    folderCounts.value = payload.folders ?? folderCounts.value
    starredCount.value = payload.starred ?? 0
    matchedTotal.value = payload.matchedTotal ?? next.length
    hasMore.value = emails.value.length < matchedTotal.value
  } catch (err) {
    const code = err instanceof ApiError ? err.code : undefined
    inboxError.value = apiErrorMessage(code, 'errors.load_inbox_failed')
    if (code === 'unauthorized' || code === 'session_expired') {
      await logout(true)
    }
  } finally {
    inboxLoading.value = false
    refreshing.value = false
    loadingMore.value = false
  }
}

export async function refreshInbox() {
  if (!mailbox.value || refreshing.value) return
  refreshing.value = true
  const keepId = selectedId.value
  await loadInbox(true)
  if (keepId && emails.value.some((e) => e.id === keepId)) {
    await openEmail(keepId, false)
  } else {
    selected.value = null
    selectedId.value = null
  }
}

export async function loadMore() {
  if (!hasMore.value || loadingMore.value || inboxLoading.value) return
  loadingMore.value = true
  await loadInbox(false)
}

export async function switchFolder(next: Folder) {
  if (folder.value === next) return
  folder.value = next
  selected.value = null
  selectedId.value = null
  mobilePane.value = 'list'
  sidebarOpen.value = false
  await loadInbox(true)
}

export async function openEmail(emailId: string, switchMobile = true) {
  if (!mailbox.value) return
  selectedId.value = emailId
  detailLoading.value = true
  if (switchMobile) mobilePane.value = 'detail'
  try {
    const response = await fetch(
      `${apiBase}/api/mailboxes/${mailbox.value.id}/emails/${emailId}`,
      { headers: { authorization: `Bearer ${token.value}` } },
    )
    const payload = await response.json()
    if (!response.ok) throw new ApiError(await readErrorCode(response))
    selected.value = {
      ...payload,
      to: payload.to ?? [],
      cc: payload.cc ?? [],
      attachments: payload.attachments ?? [],
      labels: payload.labels ?? [],
    }
    bodyMode.value = payload.bodyHtml ? 'html' : 'text'
    const item = emails.value.find((e) => e.id === emailId)
    if (item && !item.isRead) {
      item.isRead = true
      unread.value = Math.max(unread.value - 1, 0)
    }
    if (folder.value === 'unread') {
      emails.value = emails.value.filter((e) => e.id !== emailId)
      matchedTotal.value = Math.max(matchedTotal.value - 1, 0)
    }
  } catch (err) {
    inboxError.value = err instanceof ApiError ? apiErrorMessage(err.code, 'errors.load_email_failed') : gt('errors.load_email_failed')
  } finally {
    detailLoading.value = false
  }
}

export async function patchEmail(
  emailId: string,
  body: { isStarred?: boolean; folder?: 'inbox' | 'archive' | 'trash'; labels?: string[] },
) {
  if (!mailbox.value) return
  const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/emails/${emailId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token.value}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    inboxError.value = apiErrorMessage(payload.code, 'errors.patch_failed')
    return
  }
  if (payload.folders) folderCounts.value = payload.folders
  if (payload.starred !== undefined) starredCount.value = payload.starred
  if (payload.unread !== undefined) unread.value = payload.unread
  const item = emails.value.find((e) => e.id === emailId)
  if (item) {
    if (body.isStarred !== undefined) item.isStarred = body.isStarred
    if (body.folder) item.folder = body.folder
    if (body.labels) item.labels = body.labels
  }
  if (selected.value?.id === emailId) {
    if (body.isStarred !== undefined) selected.value.isStarred = body.isStarred
    if (body.folder) selected.value.folder = body.folder
    if (body.labels) selected.value.labels = body.labels
  }
  const vf = folder.value
  if (body.folder && (vf === 'inbox' || vf === 'archive' || vf === 'trash') && body.folder !== vf) {
    emails.value = emails.value.filter((e) => e.id !== emailId)
    if (selectedId.value === emailId) {
      selected.value = null
      selectedId.value = null
      mobilePane.value = 'list'
    }
  }
  if (vf === 'starred' && body.isStarred === false) {
    emails.value = emails.value.filter((e) => e.id !== emailId)
  }
  if (mailbox.value) broadcastTabEvent({ type: 'inbox-changed', mailboxId: mailbox.value.id })
}

export async function toggleRead(emailId: string) {
  if (!mailbox.value) return
  const item = emails.value.find((em) => em.id === emailId)
  const next = !(item?.isRead ?? selected.value?.isRead ?? false)
  const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/emails/${emailId}/read`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token.value}` },
    body: JSON.stringify({ isRead: next }),
  })
  if (!response.ok) {
    inboxError.value = gt('inbox.readFailed')
    return
  }
  if (item) item.isRead = next
  if (selected.value?.id === emailId) selected.value.isRead = next
  unread.value = Math.max(0, unread.value + (next ? -1 : 1))
  if (mailbox.value) broadcastTabEvent({ type: 'inbox-changed', mailboxId: mailbox.value.id })
}

export async function deleteEmail(emailId: string) {
  if (!mailbox.value) return
  if (!confirm(gt('inbox.deleteEmailConfirm'))) return
  const response = await fetch(
    `${apiBase}/api/mailboxes/${mailbox.value.id}/emails/${emailId}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token.value}` },
    },
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    inboxError.value = gt('inbox.deleteFailed')
    return
  }
  const removed = emails.value.find((e) => e.id === emailId)
  emails.value = emails.value.filter((e) => e.id !== emailId)
  if (payload.quota) {
    quotaUsed.value = payload.quota.used
    quotaLimit.value = payload.quota.limit
  } else if (removed) {
    quotaUsed.value = Math.max(quotaUsed.value - removed.size, 0)
  }
  if (payload.total !== undefined) total.value = payload.total
  else if (removed) total.value = Math.max(total.value - 1, 0)
  if (payload.unread !== undefined) unread.value = payload.unread
  else if (removed && !removed.isRead) unread.value = Math.max(unread.value - 1, 0)
  if (payload.folders) folderCounts.value = payload.folders
  if (payload.starred !== undefined) starredCount.value = payload.starred
  if (selectedId.value === emailId) {
    selected.value = null
    selectedId.value = null
    mobilePane.value = 'list'
  }
  if (mailbox.value) broadcastTabEvent({ type: 'inbox-changed', mailboxId: mailbox.value.id })
}

export async function downloadEml(emailId: string) {
  if (!mailbox.value) return
  const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/emails/${emailId}/eml`, {
    headers: { authorization: `Bearer ${token.value}` },
  })
  if (!response.ok) {
    inboxError.value = gt('inbox.emlFailed')
    return
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${emailId.slice(0, 8)}.eml`
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportMailbox(format: 'json' | 'mbox') {
  if (!mailbox.value) return
  const response = await fetch(
    `${apiBase}/api/mailboxes/${mailbox.value.id}/export?format=${format}`,
    { headers: { authorization: `Bearer ${token.value}` } },
  )
  if (!response.ok) {
    inboxError.value = gt('inbox.exportFailed')
    return
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = format === 'mbox' ? 'mailbox.mbox' : 'mailbox.json'
  a.click()
  URL.revokeObjectURL(url)
}

export async function deleteMailbox() {
  if (!mailbox.value) return
  if (!confirm(gt('inbox.deleteMailboxConfirm', { address: fullAddress.value }))) return
  deletingMailbox.value = true
  try {
    const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token.value}` },
    })
    if (!response.ok) throw new ApiError(await readErrorCode(response))
    broadcastTabEvent({ type: 'mailbox-deleted', mailboxId: mailbox.value.id })
    removeRecent(mailbox.value.id)
    await logout(true)
  } catch (err) {
    inboxError.value = err instanceof ApiError ? apiErrorMessage(err.code, 'errors.delete_mailbox_failed') : gt('errors.delete_mailbox_failed')
  } finally {
    deletingMailbox.value = false
  }
}

export async function logout(toLanding = true) {
  const id = mailbox.value?.id
  const currentToken = token.value
  if (id && currentToken) {
    try {
      await fetch(`${apiBase}/api/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${currentToken}` },
      })
    } catch {
      /* still clear local session */
    }
  }
  if (id) {
    broadcastTabEvent({ type: 'logout', mailboxId: id })
    clearToken(id)
  }
  token.value = ''
  mailbox.value = null
  emails.value = []
  selected.value = null
  selectedId.value = null
  inboxError.value = ''
  if (toLanding) view.value = 'landing'
}

export async function copyAddress() {
  if (!fullAddress.value) return
  try {
    await navigator.clipboard.writeText(fullAddress.value)
    copyHint.value = gt('inbox.copied')
  } catch {
    copyHint.value = gt('inbox.copyFailed')
  }
  window.setTimeout(() => {
    copyHint.value = ''
  }, 1600)
}

export function backToList() {
  mobilePane.value = 'list'
  selectedId.value = null
  selected.value = null
}

export function selectAdjacent(delta: number) {
  const list = filteredEmails.value
  if (list.length === 0) return
  const idx = selectedId.value ? list.findIndex((e) => e.id === selectedId.value) : -1
  const next = Math.min(Math.max(idx + delta, 0), list.length - 1)
  openEmail(list[next].id)
}

export async function syncInboxFromTab() {
  if (!mailbox.value) return
  const keepId = selectedId.value
  await loadInbox(true, true)
  if (keepId && emails.value.some((e) => e.id === keepId)) {
    if (selected.value) await openEmail(keepId, false)
  } else {
    selected.value = null
    selectedId.value = null
  }
}

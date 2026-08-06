<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import DOMPurify from 'dompurify'
import { normalizeLocalPart } from '../shared/local-part'
import { useAppI18n, setLocale, type AppLocale } from './i18n'
import { applyTheme, type Theme } from './theme'
import { broadcastTabEvent, parseTabEvent, type TabEvent } from './tabs'
import LocaleSwitcher from './components/LocaleSwitcher.vue'
import ThemeSwitcher from './components/ThemeSwitcher.vue'
import heroImage from './assets/mail-routes-hero.png'

const { t, te, locale } = useAppI18n()

type Mailbox = { id: string; localPart: string; createdAt: string }
type EmailSummary = {
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
type EmailDetail = EmailSummary & {
  bodyText: string | null
  bodyHtml: string | null
  to?: { name: string; address: string }[]
  cc?: { name: string; address: string }[]
  messageId?: string | null
  attachments?: { filename: string; mimeType: string; size: number }[]
}
type Folder = 'inbox' | 'unread' | 'starred' | 'archive' | 'trash'
type FilterItem = {
  id: string
  name: string
  matchField: string
  matchOp: string
  matchValue: string
  action: string
  enabled: boolean
  createdAt: string
}
type LandingTab = 'login' | 'create'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const domain = 'lemonhub.net'
const apiBase = import.meta.env.VITE_API_BASE ?? ''
const RECENT_KEY = 'lm-recent-mailboxes'
const TOKEN_PREFIX = 'lm-token-'
const DEVICE_KEY = 'lm-device-id'
const PAGE_SIZE = 40
const TURNSTILE_SITEKEY = '0x4AAAAAAEHG1eVxw5ySkmSQ'

const loginWidgetEl = ref<HTMLElement | null>(null)
const createWidgetEl = ref<HTMLElement | null>(null)
let loginWidgetId = ''
let createWidgetId = ''
let loginWidgetRendered = false
let createWidgetRendered = false

const view = ref<'landing' | 'inbox'>('landing')
const landingTab = ref<LandingTab>('login')
const recentMailboxes = ref<Mailbox[]>([])
let installPrompt: BeforeInstallPromptEvent | null = null
const installVisible = ref(false)
const helpOpen = ref(false)

const createLocalPart = ref('')
const createPassword = ref('')
const createInviteCode = ref('')
const createError = ref('')
const createFlash = ref('')
const creating = ref(false)
const showCreatePassword = ref(false)
const inviteRequired = ref(false)

const loginLocalPart = ref('')
const loginPassword = ref('')
const loginError = ref('')
const loggingIn = ref(false)
const showLoginPassword = ref(false)

const mailbox = ref<Mailbox | null>(null)
const token = ref('')
const emails = ref<EmailSummary[]>([])
const selected = ref<EmailDetail | null>(null)
const selectedId = ref<string | null>(null)
const inboxLoading = ref(false)
const detailLoading = ref(false)
const inboxError = ref('')
const quotaUsed = ref(0)
const quotaLimit = ref(10 * 1024 * 1024)
const total = ref(0)
const unread = ref(0)
const folderCounts = ref<Record<string, number>>({ inbox: 0, archive: 0, trash: 0 })
const starredCount = ref(0)
const matchedTotal = ref(0)
const folder = ref<Folder>('inbox')
const searchQuery = ref('')
const searchActive = ref('')
const bodyMode = ref<'html' | 'text'>('html')
const mobilePane = ref<'list' | 'detail'>('list')
const sidebarOpen = ref(false)
const settingsOpen = ref(false)
const refreshing = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const copyHint = ref('')
const deletingMailbox = ref(false)
const listRef = ref<HTMLElement | null>(null)
const filters = ref<FilterItem[]>([])
const filterField = ref<'sender' | 'subject' | 'body'>('sender')
const filterOp = ref<'contains' | 'equals'>('contains')
const filterValue = ref('')
const filterAction = ref<'delete' | 'star' | 'archive' | 'mark_read' | 'label'>('star')
const filterName = ref('')
const filterError = ref('')
const filterSaving = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

const addressPreview = computed(() => `${createLocalPart.value.trim() || 'hello'}@${domain}`)
const quotaPercent = computed(() => Math.min(Math.round((quotaUsed.value / quotaLimit.value) * 100), 100))
const quotaOver = computed(() => quotaPercent.value >= 80)
const fullAddress = computed(() => (mailbox.value ? `${mailbox.value.localPart}@${domain}` : ''))

/** Server-side search; list is already filtered by API. */
const filteredEmails = computed(() => emails.value)

function displayName(email: { sender: string; senderName?: string | null }): string {
  if (email.senderName?.trim()) return email.senderName.trim()
  return senderName(email.sender)
}

const sanitizedHtml = computed(() => {
  if (!selected.value?.bodyHtml) return ''
  return DOMPurify.sanitize(selected.value.bodyHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
  })
})

const hasHtmlBody = computed(() => Boolean(selected.value?.bodyHtml))
const hasTextBody = computed(() => Boolean(selected.value?.bodyText))

class ApiError extends Error {
  readonly code: string | undefined
  constructor(code: string | undefined) {
    super(code ?? 'unknown')
    this.code = code
  }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  const payload = (await response.json().catch(() => null)) as { code?: unknown } | null
  return typeof payload?.code === 'string' ? payload.code : undefined
}

function apiErrorMessage(code: string | undefined, fallbackKey: string): string {
  if (code && te(`errors.${code}`)) return t(`errors.${code}` as never)
  return t(fallbackKey as never)
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return t('size.mb', { n: (bytes / 1024 / 1024).toFixed(1) })
  if (bytes >= 1024) return t('size.kb', { n: Math.round(bytes / 1024) })
  return t('size.bytes', { n: bytes })
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return t('time.justNow')
  if (diffMin < 60) return t('time.minutesAgo', { n: diffMin })
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return t('time.yesterday', {
      time: date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }),
    })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleString(locale.value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleString(locale.value, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatFullTime(iso: string): string {
  return new Date(iso).toLocaleString(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function senderName(sender: string): string {
  if (!sender) return t('sender.unknown')
  const match = sender.match(/^(.+?)\s*<.+>$/)
  if (match) return match[1].replace(/^["']|["']$/g, '').trim() || sender
  return sender
}

function senderInitial(email: { sender: string; senderName?: string | null } | string): string {
  const name = typeof email === 'string' ? senderName(email) : displayName(email)
  const ch = name.charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) {
      recentMailboxes.value = []
      return
    }
    const parsed = JSON.parse(raw) as Mailbox[]
    recentMailboxes.value = Array.isArray(parsed) ? parsed.slice(0, 8) : []
  } catch {
    recentMailboxes.value = []
  }
}

function saveRecent(item: Mailbox) {
  const next = [item, ...recentMailboxes.value.filter((m) => m.id !== item.id)].slice(0, 8)
  recentMailboxes.value = next
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
}

function removeRecent(id: string) {
  recentMailboxes.value = recentMailboxes.value.filter((m) => m.id !== id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recentMailboxes.value))
  sessionStorage.removeItem(TOKEN_PREFIX + id)
}

function persistToken(id: string, value: string) {
  sessionStorage.setItem(TOKEN_PREFIX + id, value)
}

function clearToken(id: string) {
  sessionStorage.removeItem(TOKEN_PREFIX + id)
}

/** Shared rules with server (`shared/local-part.ts`). */
function validateLocalPartClient(raw: string): string | null {
  const result = normalizeLocalPart(raw)
  return result.ok ? null : apiErrorMessage(result.code, 'createForm.failed')
}

async function loadHealth() {
  try {
    const response = await fetch(`${apiBase}/api/health`)
    if (!response.ok) return
    const data = (await response.json()) as { inviteRequired?: boolean; domain?: string }
    inviteRequired.value = Boolean(data.inviteRequired)
  } catch {
    /* ignore — form still works; server will enforce */
  }
}

function renderActiveTurnstile() {
  nextTick(() => {
    const isLogin = landingTab.value === 'login'
    const el = isLogin ? loginWidgetEl.value : createWidgetEl.value
    if (!el || !window.turnstile) return
    if (isLogin ? loginWidgetRendered : createWidgetRendered) return
    const widgetId = window.turnstile.render(el, {
      sitekey: TURNSTILE_SITEKEY,
      action: 'turnstile-spin-v2',
    })
    if (isLogin) {
      loginWidgetRendered = true
      loginWidgetId = widgetId
    } else {
      createWidgetRendered = true
      createWidgetId = widgetId
    }
  })
}

function currentTurnstileToken(): string {
  const widgetId = landingTab.value === 'login' ? loginWidgetId : createWidgetId
  return window.turnstile?.getResponse(widgetId) ?? ''
}

function resetTurnstile() {
  const widgetId = landingTab.value === 'login' ? loginWidgetId : createWidgetId
  if (!widgetId || !window.turnstile) return
  try {
    window.turnstile.reset(widgetId)
  } catch {
    return
  }
}

async function createMailbox() {
  createError.value = ''
  createFlash.value = ''
  if (!createLocalPart.value.trim() || !createPassword.value.trim()) {
    createError.value = t('createForm.fillAll')
    return
  }
  const prefixError = validateLocalPartClient(createLocalPart.value)
  if (prefixError) {
    createError.value = prefixError
    return
  }
  if (createPassword.value.length < 8) {
    createError.value = t('createForm.passwordShort')
    return
  }
  if (inviteRequired.value && !createInviteCode.value.trim()) {
    createError.value = t('createForm.inviteRequired')
    return
  }
  creating.value = true
  try {
    const turnstileToken = currentTurnstileToken()
    if (!turnstileToken) {
      createError.value = t('createForm.turnstileRequired')
      return
    }
    const response = await fetch(`${apiBase}/api/mailboxes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'device-id': deviceId() },
      body: JSON.stringify({
        localPart: createLocalPart.value,
        password: createPassword.value,
        'cf-turnstile-response': turnstileToken,
        ...(createInviteCode.value.trim() ? { inviteCode: createInviteCode.value.trim() } : {}),
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new ApiError(await readErrorCode(response))
    const created: Mailbox = {
      id: payload.id,
      localPart: payload.localPart,
      createdAt: payload.createdAt,
    }
    saveRecent(created)
    token.value = payload.token
    persistToken(created.id, payload.token)
    mailbox.value = created
    createLocalPart.value = ''
    createPassword.value = ''
    createInviteCode.value = ''
    createFlash.value = t('createForm.created', { address: `${created.localPart}@${domain}` })
    await enterInbox()
  } catch (err) {
    createError.value = err instanceof ApiError ? apiErrorMessage(err.code, 'createForm.failed') : t('createForm.failed')
    resetTurnstile()
  } finally {
    creating.value = false
  }
}

async function doLogin() {
  loginError.value = ''
  if (!loginLocalPart.value.trim() || !loginPassword.value) {
    loginError.value = t('loginForm.fillAll')
    return
  }
  loggingIn.value = true
  try {
    const turnstileToken = currentTurnstileToken()
    if (!turnstileToken) {
      loginError.value = t('loginForm.turnstileRequired')
      return
    }
    const response = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        localPart: loginLocalPart.value.trim(),
        password: loginPassword.value,
        'cf-turnstile-response': turnstileToken,
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new ApiError(await readErrorCode(response))
    const mb: Mailbox = payload.mailbox
    saveRecent(mb)
    token.value = payload.token
    persistToken(mb.id, payload.token)
    mailbox.value = mb
    loginPassword.value = ''
    await enterInbox()
  } catch (err) {
    loginError.value = err instanceof ApiError ? apiErrorMessage(err.code, 'loginForm.failed') : t('loginForm.failed')
    resetTurnstile()
  } finally {
    loggingIn.value = false
  }
}

function pickRecent(item: Mailbox) {
  loginLocalPart.value = item.localPart
  landingTab.value = 'login'
  const saved = sessionStorage.getItem(TOKEN_PREFIX + item.id)
  if (saved) {
    token.value = saved
    mailbox.value = item
    enterInbox()
  }
}

async function enterInbox() {
  view.value = 'inbox'
  selected.value = null
  selectedId.value = null
  mobilePane.value = 'list'
  folder.value = 'inbox'
  searchQuery.value = ''
  sidebarOpen.value = false
  await loadInbox(true)
}

async function loadInbox(reset = false, silent = false) {
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

async function refreshInbox() {
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

async function loadMore() {
  if (!hasMore.value || loadingMore.value || inboxLoading.value) return
  loadingMore.value = true
  await loadInbox(false)
}

async function switchFolder(next: Folder) {
  if (folder.value === next) return
  folder.value = next
  selected.value = null
  selectedId.value = null
  mobilePane.value = 'list'
  sidebarOpen.value = false
  await loadInbox(true)
}

async function openEmail(emailId: string, switchMobile = true) {
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
    inboxError.value = err instanceof ApiError ? apiErrorMessage(err.code, 'errors.load_email_failed') : t('errors.load_email_failed')
  } finally {
    detailLoading.value = false
  }
}

async function patchEmail(
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

async function downloadEml(emailId: string) {
  if (!mailbox.value) return
  const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/emails/${emailId}/eml`, {
    headers: { authorization: `Bearer ${token.value}` },
  })
  if (!response.ok) {
    inboxError.value = t('inbox.emlFailed')
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

async function exportMailbox(format: 'json' | 'mbox') {
  if (!mailbox.value) return
  const response = await fetch(
    `${apiBase}/api/mailboxes/${mailbox.value.id}/export?format=${format}`,
    { headers: { authorization: `Bearer ${token.value}` } },
  )
  if (!response.ok) {
    inboxError.value = t('inbox.exportFailed')
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

async function loadFilters() {
  if (!mailbox.value) return
  const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/filters`, {
    headers: { authorization: `Bearer ${token.value}` },
  })
  if (!response.ok) return
  const payload = await response.json()
  filters.value = payload.filters ?? []
}

async function createFilter() {
  if (!mailbox.value) return
  filterError.value = ''
  if (!filterValue.value.trim()) {
    filterError.value = t('filters.valueRequired')
    return
  }
  filterSaving.value = true
  try {
    const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/filters`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.value}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: filterName.value.trim(),
        matchField: filterField.value,
        matchOp: filterOp.value,
        matchValue: filterValue.value.trim(),
        action: filterAction.value,
        enabled: true,
      }),
    })
    if (!response.ok) throw new ApiError(await readErrorCode(response))
    filterValue.value = ''
    filterName.value = ''
    await loadFilters()
  } catch (err) {
    filterError.value = err instanceof ApiError ? apiErrorMessage(err.code, 'filters.createFailed') : t('filters.createFailed')
  } finally {
    filterSaving.value = false
  }
}

async function deleteFilter(filterId: string) {
  if (!mailbox.value) return
  await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/filters/${filterId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token.value}` },
  })
  await loadFilters()
}

async function deleteEmail(emailId: string) {
  if (!mailbox.value) return
  if (!confirm(t('inbox.deleteEmailConfirm'))) return
  const response = await fetch(
    `${apiBase}/api/mailboxes/${mailbox.value.id}/emails/${emailId}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token.value}` },
    },
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    inboxError.value = t('inbox.deleteFailed')
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
async function deleteMailbox() {
  if (!mailbox.value) return
  if (!confirm(t('inbox.deleteMailboxConfirm', { address: fullAddress.value }))) return
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
    inboxError.value = err instanceof ApiError ? apiErrorMessage(err.code, 'errors.delete_mailbox_failed') : t('errors.delete_mailbox_failed')
  } finally {
    deletingMailbox.value = false
  }
}

async function logout(toLanding = true) {
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

async function copyAddress() {
  if (!fullAddress.value) return
  try {
    await navigator.clipboard.writeText(fullAddress.value)
    copyHint.value = t('inbox.copied')
  } catch {
    copyHint.value = t('inbox.copyFailed')
  }
  window.setTimeout(() => {
    copyHint.value = ''
  }, 1600)
}

function backToList() {
  mobilePane.value = 'list'
  selectedId.value = null
  selected.value = null
}

function selectAdjacent(delta: number) {
  const list = filteredEmails.value
  if (list.length === 0) return
  const idx = selectedId.value ? list.findIndex((e) => e.id === selectedId.value) : -1
  const next = Math.min(Math.max(idx + delta, 0), list.length - 1)
  openEmail(list[next].id)
}

function onKeydown(e: KeyboardEvent) {
  if (view.value !== 'inbox') return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return
  if (e.key === '?') {
    e.preventDefault()
    helpOpen.value = true
    return
  }
  if (e.key === 'Escape') {
    if (helpOpen.value) {
      helpOpen.value = false
      return
    }
    if (selected.value && window.matchMedia('(max-width: 767px)').matches) {
      backToList()
    } else if (sidebarOpen.value) {
      sidebarOpen.value = false
    }
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && (e.metaKey || e.ctrlKey)) {
    if (selectedId.value) {
      e.preventDefault()
      deleteEmail(selectedId.value)
    }
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault()
    selectAdjacent(1)
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault()
    selectAdjacent(-1)
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault()
    refreshInbox()
  } else if (e.key === 'u') {
    e.preventDefault()
    if (selected.value) backToList()
  } else if (selectedId.value) {
    if (e.key === 'a') {
      e.preventDefault()
      patchEmail(selectedId.value, { folder: selected.value?.folder === 'archive' ? 'inbox' : 'archive' })
    } else if (e.key === 's') {
      e.preventDefault()
      patchEmail(selectedId.value, { isStarred: !selected.value?.isStarred })
    } else if (e.key === 'm') {
      e.preventDefault()
      patchEmail(selectedId.value, { folder: selected.value?.folder === 'trash' ? 'inbox' : 'trash' })
    } else if (e.key === 'x') {
      e.preventDefault()
      toggleRead(selectedId.value)
    } else if (folderKey(e.key)) {
      e.preventDefault()
      switchFolder(folderKey(e.key)!)
    }
  }
}

function folderKey(key: string): Folder | undefined {
  const map: Record<string, Folder> = { '1': 'inbox', '2': 'unread', '3': 'starred', '4': 'archive', '5': 'trash' }
  return map[key]
}

async function toggleRead(emailId: string) {
  if (!mailbox.value) return
  const item = emails.value.find((em) => em.id === emailId)
  const next = !(item?.isRead ?? selected.value?.isRead ?? false)
  const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/emails/${emailId}/read`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token.value}` },
    body: JSON.stringify({ isRead: next }),
  })
  if (!response.ok) {
    inboxError.value = t('inbox.readFailed')
    return
  }
  if (item) item.isRead = next
  if (selected.value?.id === emailId) selected.value.isRead = next
  unread.value = Math.max(0, unread.value + (next ? -1 : 1))
  if (mailbox.value) broadcastTabEvent({ type: 'inbox-changed', mailboxId: mailbox.value.id })
}

watch(folder, () => {
  searchQuery.value = ''
  searchActive.value = ''
})

watch(searchQuery, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(async () => {
    searchActive.value = searchQuery.value.trim()
    selected.value = null
    selectedId.value = null
    await loadInbox(true)
  }, 350)
})

watch(landingTab, () => {
  loginWidgetRendered = false
  createWidgetRendered = false
  renderActiveTurnstile()
})

watch(settingsOpen, (open) => {
  if (open) loadFilters()
})

watch(selectedId, async (id) => {
  if (!id) return
  await nextTick()
  const el = listRef.value?.querySelector(`[data-email-id="${id}"]`) as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest' })
})

watchEffect(() => {
  const description = t('meta.description')
  document.documentElement.lang = locale.value
  document.title = t('meta.title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', description)
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', description)
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', description)
  document.querySelector('meta[property="og:locale"]')?.setAttribute('content', locale.value.replace('-', '_'))
})

onMounted(() => {
  loadRecent()
  loadHealth()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('storage', onStorage)
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('storage', onStorage)
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.removeEventListener('appinstalled', onAppInstalled)
})

let tabSyncTimer: ReturnType<typeof setTimeout> | null = null

function onStorage(e: StorageEvent) {
  if (!e.key || e.newValue === null) return
  if (e.key === 'lm-theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
    applyTheme(e.newValue as Theme)
  } else if (e.key === 'lm-locale' && (e.newValue === 'zh-CN' || e.newValue === 'en-US')) {
    setLocale(e.newValue as AppLocale)
  } else if (e.key === 'lm-recent-mailboxes') {
    loadRecent()
  } else if (e.key === 'lm-event') {
    const ev = parseTabEvent(e.newValue)
    if (ev) handleTabEvent(ev)
  }
}

function handleTabEvent(ev: TabEvent) {
  const currentId = mailbox.value?.id
  if (!currentId || ev.mailboxId !== currentId) return
  if (ev.type === 'logout' || ev.type === 'mailbox-deleted') {
    void logout(true)
  } else if (ev.type === 'inbox-changed' && view.value === 'inbox') {
    if (tabSyncTimer) clearTimeout(tabSyncTimer)
    tabSyncTimer = setTimeout(() => void syncInboxFromTab(), 400)
  }
}

async function syncInboxFromTab() {
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

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault()
  installPrompt = e as BeforeInstallPromptEvent
  installVisible.value = true
}

function onAppInstalled() {
  installPrompt = null
  installVisible.value = false
}

async function installApp() {
  if (!installPrompt) return
  await installPrompt.prompt()
  installPrompt = null
  installVisible.value = false
}
</script>

<template>
  <a
    href="#top"
    class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
  >{{ t('nav.skip') }}</a>

  <!-- ── Landing ── -->
  <div v-if="view === 'landing'" class="min-h-dvh bg-canvas text-ink">
    <nav
      class="sticky top-0 z-40 mx-auto flex h-[calc(68px+env(safe-area-inset-top))] max-w-7xl items-center justify-between border-b border-line/60 bg-canvas/80 px-5 pt-[env(safe-area-inset-top)] backdrop-blur-md md:px-8"
      :aria-label="t('nav.mainNav')"
    >
      <a class="flex items-center gap-2.5 font-semibold tracking-tight" href="#top">
        <span class="grid size-8 place-items-center rounded-[10px] bg-ink text-sm font-bold text-canvas">L</span>
        <span>Lemon Mail</span>
      </a>
      <div class="flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeSwitcher />
        <button
          v-if="installVisible"
          class="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-line-3 hover:bg-surface active:scale-[.98] sm:px-4 sm:py-2 sm:text-sm"
          type="button"
          @click="installApp"
        >
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M4 21h16" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="hidden sm:inline">{{ t('nav.install') }}</span>
        </button>
        <a
          class="hidden rounded-full px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface sm:inline-flex"
          href="#access"
          @click="landingTab = 'login'"
        >{{ t('nav.login') }}</a>
        <a
          class="rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas transition hover:bg-ink-2 active:scale-[.98]"
          href="#access"
          @click="landingTab = 'create'"
        >{{ t('nav.create') }}</a>
      </div>
    </nav>

    <section id="top" class="relative mx-auto grid min-h-[calc(100dvh-68px-env(safe-area-inset-top))] max-w-7xl items-center gap-10 px-5 pb-16 pt-12 md:px-8 lg:grid-cols-[0.94fr_1.06fr] lg:gap-12 lg:pb-24 lg:pt-20">
      <div class="relative z-10 max-w-xl">
        <p class="lm-rise mb-6 flex items-center gap-2 text-sm font-medium tracking-wide text-accent-strong">
          <span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
          {{ t('hero.badge') }}
        </p>
        <h1 class="lm-rise text-4xl font-semibold leading-[1.06] tracking-[-0.05em] text-balance sm:text-6xl sm:leading-[1.04] lg:text-7xl" style="animation-delay: 70ms">{{ t('hero.heading') }}</h1>
        <p class="lm-rise mt-6 max-w-md text-base leading-7 text-ink-3 sm:mt-7 sm:text-lg sm:leading-8" style="animation-delay: 140ms">
          {{ t('hero.tagline') }}
        </p>
        <div class="lm-rise mt-8 flex flex-wrap items-center gap-3 sm:mt-9" style="animation-delay: 210ms">
          <a
            class="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 font-medium text-accent-ink shadow-[0_12px_30px_rgba(230,109,64,0.18)] transition hover:bg-accent-hover active:scale-[.98] sm:w-auto"
            href="#access"
            @click="landingTab = 'create'"
          >
            {{ t('hero.create') }}
            <svg class="size-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
          <a
            class="inline-flex w-full items-center justify-center rounded-full border border-line-2 px-6 py-3 font-medium text-ink-2 transition hover:border-line-3 hover:bg-surface active:scale-[.98] sm:w-auto"
            href="#access"
            @click="landingTab = 'login'"
          >{{ t('hero.login') }}</a>
        </div>
      </div>
      <div class="lm-rise relative mx-auto w-full max-w-[620px] lg:mr-0" style="animation-delay: 280ms">
        <div class="absolute -inset-12 -z-10 rounded-full bg-hero-glow blur-3xl"></div>
        <div class="overflow-hidden rounded-[24px] ring-1 ring-line shadow-[0_30px_80px_rgba(41,65,53,0.12)] sm:rounded-[28px]">
          <img
            class="aspect-[4/3] w-full object-cover transition-transform duration-700 ease-out hover:scale-[1.02] sm:aspect-[4/5]"
            :src="heroImage"
            :alt="t('hero.alt')"
          />
        </div>
        <div
          class="absolute bottom-4 left-4 flex items-center gap-2.5 rounded-full border border-canvas/40 bg-surface/80 py-2 pl-3 pr-4 shadow-[0_12px_32px_rgba(41,65,53,0.14)] backdrop-blur-md sm:bottom-5 sm:left-5"
        >
          <span class="grid size-7 place-items-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
            <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M4 6h16v12H4z" stroke-linejoin="round" />
              <path d="m4 8 8 6 8-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="text-sm font-medium tabular-nums">{{ t('trustBar.domain') }}</span>
        </div>
      </div>
    </section>

    <section class="border-y border-line bg-surface-3 py-7">
      <div class="mx-auto flex max-w-7xl flex-col gap-4 px-5 md:flex-row md:items-center md:justify-between md:px-8">
        <p class="text-sm font-medium text-ink-3">{{ t('trustBar.text') }}</p>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-2">
          <span class="flex items-center gap-6"><span class="size-1 rounded-full bg-accent/70" aria-hidden="true"></span>{{ t('trustBar.password') }}</span>
          <span class="flex items-center gap-6"><span class="size-1 rounded-full bg-accent/70" aria-hidden="true"></span>{{ t('trustBar.hosting') }}</span>
          <span class="flex items-center gap-6"><span class="size-1 rounded-full bg-accent/70" aria-hidden="true"></span>{{ t('trustBar.recent') }}</span>
          <span class="flex items-center gap-6"><span class="size-1 rounded-full bg-accent/70" aria-hidden="true"></span>{{ t('trustBar.domain') }}</span>
        </div>
      </div>
    </section>

    <section id="access" class="mx-auto max-w-7xl scroll-mt-20 px-5 py-20 md:px-8 lg:py-28">
      <div class="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
        <div>
          <p class="mb-4 flex items-center gap-2 text-sm font-medium tracking-wide text-accent-strong">
            <span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
            {{ t('access.badge') }}
          </p>
          <h2 class="text-4xl font-semibold leading-[1.1] tracking-[-0.045em] text-balance sm:text-5xl">{{ t('access.heading1') }}<br />{{ t('access.heading2') }}</h2>
          <p class="mt-5 max-w-sm leading-7 text-ink-3">
            {{ t('access.description') }}
          </p>

          <div v-if="recentMailboxes.length" class="mt-10">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="text-sm font-medium text-ink-3">{{ t('recent.heading') }}</h3>
              <span class="text-xs text-ink-5">{{ t('recent.note') }}</span>
            </div>
            <ul class="grid gap-2">
              <li v-for="item in recentMailboxes" :key="item.id">
                <div class="flex items-center gap-2 rounded-[14px] border border-line bg-surface p-2 pl-4 transition hover:border-line-3">
                  <button
                    class="min-w-0 flex-1 text-left"
                    type="button"
                    @click="pickRecent(item)"
                  >
                    <p class="truncate font-medium">{{ item.localPart }}@{{ domain }}</p>
                    <p class="mt-0.5 text-xs text-ink-4">{{ t('recent.clickToFill') }}</p>
                  </button>
                  <button
                    class="shrink-0 rounded-full px-3 py-1.5 text-xs text-danger transition hover:bg-error-bg"
                    type="button"
                    :title="t('recent.removeTitle')"
                    @click="removeRecent(item.id)"
                  >{{ t('recent.remove') }}</button>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div class="rounded-[20px] border border-line bg-surface p-5 shadow-[0_20px_50px_rgba(41,65,53,0.06)] sm:p-7">
          <div class="mb-6 grid grid-cols-2 gap-1 rounded-[12px] bg-surface-3 p-1" role="tablist">
            <button
              class="rounded-[10px] px-3 py-2.5 text-sm font-medium transition"
              :class="landingTab === 'login' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'"
              type="button"
              role="tab"
              :aria-selected="landingTab === 'login'"
              @click="landingTab = 'login'"
            >{{ t('tabs.login') }}</button>
            <button
              class="rounded-[10px] px-3 py-2.5 text-sm font-medium transition"
              :class="landingTab === 'create' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'"
              type="button"
              role="tab"
              :aria-selected="landingTab === 'create'"
              @click="landingTab = 'create'"
            >{{ t('tabs.create') }}</button>
          </div>

          <form v-if="landingTab === 'login'" class="grid gap-5" @submit.prevent="doLogin">
            <div>
              <label class="mb-2 block text-sm font-medium" for="login-local">{{ t('loginForm.emailLabel') }}</label>
              <div class="flex overflow-hidden rounded-[12px] border border-line-2 bg-surface-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                <input
                  id="login-local"
                  v-model="loginLocalPart"
                  class="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none"
                  :placeholder="t('loginForm.emailPlaceholder')"
                  autocomplete="username"
                  spellcheck="false"
                />
                <span class="flex items-center border-l border-line px-3 text-sm text-ink-3">@{{ domain }}</span>
              </div>
            </div>
            <div>
              <label class="mb-2 block text-sm font-medium" for="login-password">{{ t('loginForm.passwordLabel') }}</label>
              <div class="relative">
                <input
                  id="login-password"
                  v-model="loginPassword"
                  class="w-full rounded-[12px] border border-line-2 bg-surface-2 px-4 py-3 pr-16 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm"
                  :type="showLoginPassword ? 'text' : 'password'"
                  :placeholder="t('loginForm.passwordPlaceholder')"
                  autocomplete="current-password"
                />
                <button
                  class="absolute inset-y-0 right-2 my-auto h-8 rounded-full px-2.5 text-xs font-medium text-ink-3 hover:text-ink"
                  type="button"
                  @click="showLoginPassword = !showLoginPassword"
                >{{ showLoginPassword ? t('loginForm.hide') : t('loginForm.show') }}</button>
              </div>
            </div>
            <p v-if="loginError" class="rounded-[12px] bg-error-bg px-4 py-3 text-sm text-danger" role="alert">{{ loginError }}</p>
            <div
              class="cf-turnstile"
              data-action="turnstile-spin-v2"
              ref="loginWidgetEl"
            ></div>
            <button
              class="w-full rounded-full bg-ink px-5 py-3 font-medium text-canvas transition hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60 active:translate-y-px"
              type="submit"
              :disabled="loggingIn"
            >{{ loggingIn ? t('loginForm.submitting') : t('loginForm.submit') }}</button>
          </form>

          <form v-else class="grid gap-5" @submit.prevent="createMailbox">
            <div>
              <label class="mb-2 block text-sm font-medium" for="create-local">{{ t('createForm.localLabel') }}</label>
              <div class="flex overflow-hidden rounded-[12px] border border-line-2 bg-surface-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                <input
                  id="create-local"
                  v-model="createLocalPart"
                  class="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none"
                  :placeholder="t('createForm.localPlaceholder')"
                  autocomplete="off"
                  spellcheck="false"
                />
                <span class="flex items-center border-l border-line px-3 text-sm text-ink-3">@{{ domain }}</span>
              </div>
              <p class="mt-2 text-sm text-ink-4">{{ t('createForm.localHint', { address: addressPreview }) }}</p>
            </div>
            <div>
              <label class="mb-2 block text-sm font-medium" for="create-password">{{ t('createForm.passwordLabel') }}</label>
              <div class="relative">
                <input
                  id="create-password"
                  v-model="createPassword"
                  class="w-full rounded-[12px] border border-line-2 bg-surface-2 px-4 py-3 pr-16 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm"
                  :type="showCreatePassword ? 'text' : 'password'"
                  :placeholder="t('createForm.passwordPlaceholder')"
                  autocomplete="new-password"
                />
                <button
                  class="absolute inset-y-0 right-2 my-auto h-8 rounded-full px-2.5 text-xs font-medium text-ink-3 hover:text-ink"
                  type="button"
                  @click="showCreatePassword = !showCreatePassword"
                >{{ showCreatePassword ? t('createForm.hide') : t('createForm.show') }}</button>
              </div>
              <p class="mt-2 text-sm text-ink-4">{{ t('createForm.passwordHint') }}</p>
              <p class="mt-3 flex items-center gap-1.5 rounded-[10px] bg-surface-3 px-3 py-2 text-xs text-ink-3">
                <svg class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4M12 16h.01" stroke-linecap="round" />
                </svg>
                {{ t('createForm.onePerUser') }}
              </p>
            </div>
            <div v-if="inviteRequired">
              <label class="mb-2 block text-sm font-medium" for="create-invite">{{ t('createForm.inviteLabel') }}</label>
              <input
                id="create-invite"
                v-model="createInviteCode"
                class="w-full rounded-[12px] border border-line-2 bg-surface-2 px-4 py-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm"
                type="text"
                :placeholder="t('createForm.invitePlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
            <p v-if="createError" class="rounded-[12px] bg-error-bg px-4 py-3 text-sm text-danger" role="alert">{{ createError }}</p>
            <p v-if="createFlash" class="rounded-[12px] bg-success-bg px-4 py-3 text-sm text-success" role="status">{{ createFlash }}</p>
            <div
              class="cf-turnstile"
              data-action="turnstile-spin-v2"
              ref="createWidgetEl"
            ></div>
            <button
              class="w-full rounded-full bg-ink px-5 py-3 font-medium text-canvas transition hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60 active:translate-y-px"
              type="submit"
              :disabled="creating"
            >{{ creating ? t('createForm.submitting') : t('createForm.submit') }}</button>
          </form>
        </div>
      </div>
    </section>

    <section id="how" class="mx-auto max-w-7xl scroll-mt-20 px-5 py-24 md:px-8 lg:py-32">
      <div class="grid gap-14 lg:grid-cols-[1fr_1.15fr] lg:gap-24">
        <div class="lg:sticky lg:top-28 lg:self-start">
          <p class="mb-4 flex items-center gap-2 text-sm font-medium tracking-wide text-accent-strong">
            <span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
            {{ t('how.naming.kicker') }}
          </p>
          <h2 class="max-w-md text-4xl font-semibold leading-[1.1] tracking-[-0.045em] text-balance sm:text-5xl">{{ t('how.sectionTitle') }}</h2>
          <p class="mt-5 max-w-sm leading-7 text-ink-3">{{ t('how.sectionTagline') }}</p>
        </div>

        <ol class="divide-y divide-line">
          <li class="group flex gap-6 py-8 first:pt-0 last:pb-0 lg:gap-8">
            <span class="pt-1 text-3xl font-semibold tabular-nums tracking-tight text-ink-5 transition-colors group-hover:text-accent-strong lg:text-4xl">01</span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-accent-strong">{{ t('how.naming.kicker') }}</p>
              <h3 class="mt-2 text-2xl font-semibold tracking-tight">{{ t('how.naming.title') }}</h3>
              <p class="mt-3 max-w-md leading-7 text-ink-3">{{ t('how.naming.body') }}</p>
            </div>
          </li>
          <li class="group flex gap-6 py-8 first:pt-0 last:pb-0 lg:gap-8">
            <span class="pt-1 text-3xl font-semibold tabular-nums tracking-tight text-ink-5 transition-colors group-hover:text-accent-strong lg:text-4xl">02</span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-accent-strong">{{ t('how.hosting.kicker') }}</p>
              <h3 class="mt-2 text-2xl font-semibold tracking-tight">{{ t('how.hosting.title') }}</h3>
              <p class="mt-3 max-w-md leading-7 text-ink-3">{{ t('how.hosting.body') }}</p>
            </div>
          </li>
          <li class="group flex gap-6 py-8 first:pt-0 last:pb-0 lg:gap-8">
            <span class="pt-1 text-3xl font-semibold tabular-nums tracking-tight text-ink-5 transition-colors group-hover:text-accent-strong lg:text-4xl">03</span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-accent-strong">{{ t('how.privacy.kicker') }}</p>
              <h3 class="mt-2 text-2xl font-semibold tracking-tight">{{ t('how.privacy.title') }}</h3>
              <p class="mt-3 max-w-md leading-7 text-ink-3">{{ t('how.privacy.body') }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <footer class="border-t border-line px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-8">
      <div class="mx-auto flex max-w-7xl flex-col gap-3 text-sm text-ink-4 sm:flex-row sm:items-center sm:justify-between">
        <span>{{ t('footer.copyright') }}</span>
        <span class="tabular-nums">{{ t('footer.service') }}</span>
      </div>
    </footer>
  </div>

  <!-- ── Mail client ── -->
  <div v-else class="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
    <header class="z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-3 border-b border-line bg-canvas/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:px-4">
      <button
        class="grid size-9 place-items-center rounded-[10px] text-ink-2 transition hover:bg-chip md:hidden"
        type="button"
        :aria-label="t('inbox.openMenu')"
        @click="sidebarOpen = true"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />
        </svg>
      </button>

      <div class="flex min-w-0 items-center gap-2.5">
        <span class="grid size-8 shrink-0 place-items-center rounded-[10px] bg-ink text-sm font-bold text-canvas">L</span>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold tracking-tight">Lemon Mail</p>
          <p class="truncate text-xs text-ink-4">{{ fullAddress }}</p>
        </div>
      </div>

      <div class="ml-auto flex items-center gap-1.5 sm:gap-2">
        <button
          class="hidden items-center gap-1.5 rounded-full border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-line-3 hover:bg-surface sm:inline-flex active:translate-y-px"
          type="button"
          @click="copyAddress"
        >
          <span>{{ copyHint || t('inbox.copyAddress') }}</span>
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2.5 py-1.5 text-xs font-medium text-ink-2 transition hover:border-line-3 hover:bg-surface disabled:opacity-50 active:translate-y-px sm:px-3"
          type="button"
          :disabled="refreshing"
          @click="refreshInbox"
        >
          <svg
            class="size-3.5"
            :class="refreshing ? 'animate-spin' : ''"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke-linecap="round" />
            <path d="M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="hidden sm:inline">{{ refreshing ? t('inbox.refreshing') : t('inbox.refresh') }}</span>
        </button>
        <button
          class="rounded-full px-3 py-1.5 text-xs font-medium text-ink-3 transition hover:bg-chip hover:text-ink active:translate-y-px"
          type="button"
          @click="settingsOpen = true"
        >{{ t('inbox.settings') }}</button>
        <div class="hidden items-center gap-2 md:flex">
          <LocaleSwitcher />
          <ThemeSwitcher />
          <button
            class="rounded-full px-3 py-1.5 text-xs font-medium text-ink-3 transition hover:bg-chip hover:text-ink active:translate-y-px"
            type="button"
            @click="logout(true)"
          >{{ t('inbox.logout') }}</button>
        </div>
      </div>
    </header>

    <div class="relative flex min-h-0 flex-1">
      <!-- Mobile sidebar backdrop -->
      <Transition name="lm-fade">
        <div
          v-if="sidebarOpen"
          class="absolute inset-0 z-40 bg-ink/30 md:hidden"
          @click="sidebarOpen = false"
        ></div>
      </Transition>

      <!-- Sidebar -->
      <aside
        class="absolute inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col border-r border-line bg-canvas transition-transform md:static md:z-0 md:translate-x-0"
        :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
      >
        <div class="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
          <span class="text-sm font-semibold">{{ t('inbox.folders') }}</span>
          <button class="rounded-full px-2 py-1 text-sm text-ink-3" type="button" @click="sidebarOpen = false">{{ t('inbox.close') }}</button>
        </div>

        <nav class="flex flex-col gap-1 p-3" :aria-label="t('inbox.folderNav')">
          <button
            class="relative flex items-center justify-between rounded-[12px] px-3 py-2.5 pl-3.5 text-left text-sm font-medium transition"
            :class="folder === 'inbox' ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-chip'"
            type="button"
            @click="switchFolder('inbox')"
          >
            <span v-if="folder === 'inbox'" class="absolute left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent" aria-hidden="true"></span>
            <span class="flex items-center gap-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M4 6h16v12H4z" stroke-linejoin="round" />
                <path d="m4 8 8 6 8-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              {{ t('inbox.inbox') }}
            </span>
            <span
              class="rounded-full px-2 py-0.5 text-xs tabular-nums"
              :class="folder === 'inbox' ? 'bg-ink text-canvas' : 'bg-chip text-ink-3'"
            >{{ folderCounts.inbox ?? 0 }}</span>
          </button>
          <button
            class="relative flex items-center justify-between rounded-[12px] px-3 py-2.5 pl-3.5 text-left text-sm font-medium transition"
            :class="folder === 'unread' ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-chip'"
            type="button"
            @click="switchFolder('unread')"
          >
            <span v-if="folder === 'unread'" class="absolute left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent" aria-hidden="true"></span>
            <span class="flex items-center gap-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
              </svg>
              {{ t('inbox.unread') }}
            </span>
            <span
              class="rounded-full px-2 py-0.5 text-xs tabular-nums"
              :class="folder === 'unread' ? 'bg-ink text-canvas' : unread > 0 ? 'bg-error-bg text-accent-strong' : 'bg-chip text-ink-3'"
            >{{ unread }}</span>
          </button>
          <button
            class="relative flex items-center justify-between rounded-[12px] px-3 py-2.5 pl-3.5 text-left text-sm font-medium transition"
            :class="folder === 'starred' ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-chip'"
            type="button"
            @click="switchFolder('starred')"
          >
            <span v-if="folder === 'starred'" class="absolute left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent" aria-hidden="true"></span>
            <span>{{ t('inbox.starred') }}</span>
            <span class="rounded-full px-2 py-0.5 text-xs tabular-nums" :class="folder === 'starred' ? 'bg-ink text-canvas' : 'bg-chip text-ink-3'">{{ starredCount }}</span>
          </button>
          <button
            class="relative flex items-center justify-between rounded-[12px] px-3 py-2.5 pl-3.5 text-left text-sm font-medium transition"
            :class="folder === 'archive' ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-chip'"
            type="button"
            @click="switchFolder('archive')"
          >
            <span v-if="folder === 'archive'" class="absolute left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent" aria-hidden="true"></span>
            <span>{{ t('inbox.archive') }}</span>
            <span class="rounded-full px-2 py-0.5 text-xs tabular-nums" :class="folder === 'archive' ? 'bg-ink text-canvas' : 'bg-chip text-ink-3'">{{ folderCounts.archive ?? 0 }}</span>
          </button>
          <button
            class="relative flex items-center justify-between rounded-[12px] px-3 py-2.5 pl-3.5 text-left text-sm font-medium transition"
            :class="folder === 'trash' ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-chip'"
            type="button"
            @click="switchFolder('trash')"
          >
            <span v-if="folder === 'trash'" class="absolute left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent" aria-hidden="true"></span>
            <span>{{ t('inbox.trash') }}</span>
            <span class="rounded-full px-2 py-0.5 text-xs tabular-nums" :class="folder === 'trash' ? 'bg-ink text-canvas' : 'bg-chip text-ink-3'">{{ folderCounts.trash ?? 0 }}</span>
          </button>
        </nav>

        <div class="mt-auto space-y-4 border-t border-line p-4">
          <div>
            <div class="mb-1.5 flex items-center justify-between text-xs text-ink-4">
              <span>{{ t('inbox.storage') }}</span>
              <span class="tabular-nums">{{ formatSize(quotaUsed) }} / {{ formatSize(quotaLimit) }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-chip">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="quotaOver ? 'bg-accent-strong' : 'bg-success'"
                :style="{ width: quotaPercent + '%' }"
              ></div>
            </div>
            <p v-if="quotaOver" class="mt-1.5 text-xs text-accent-strong">{{ t('inbox.quotaWarning') }}</p>
          </div>

          <div class="rounded-[12px] bg-surface-3 p-3">
            <p class="truncate text-xs font-medium text-ink-3">{{ t('inbox.currentAddress') }}</p>
            <p class="mt-1 truncate text-sm font-medium">{{ fullAddress }}</p>
            <button
              class="mt-2 text-xs font-medium text-accent-strong underline-offset-2 hover:underline"
              type="button"
              @click="copyAddress"
            >{{ copyHint || t('inbox.copyToClipboard') }}</button>
          </div>

          <button
            class="w-full rounded-[12px] border border-danger/40 bg-surface px-3 py-2 text-left text-xs font-medium text-danger transition hover:bg-error-bg disabled:opacity-50"
            type="button"
            :disabled="deletingMailbox"
            @click="deleteMailbox"
          >{{ deletingMailbox ? t('inbox.deletingMailbox') : t('inbox.deleteMailbox') }}</button>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          <LocaleSwitcher />
          <button
            class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink-3 transition hover:bg-chip hover:text-ink active:translate-y-px"
            type="button"
            @click="logout(true)"
          >
            <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            {{ t('inbox.logout') }}
          </button>
        </div>
      </aside>

      <!-- List pane -->
      <section
        class="flex w-full min-w-0 flex-col border-r border-line bg-canvas md:w-[360px] md:shrink-0 lg:w-[400px]"
        :class="mobilePane === 'detail' ? 'hidden md:flex' : 'flex'"
      >
        <div class="shrink-0 space-y-3 border-b border-line p-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">
              {{
                folder === 'unread' ? t('inbox.listTitleUnread')
                : folder === 'starred' ? t('inbox.listTitleStarred')
                : folder === 'archive' ? t('inbox.listTitleArchive')
                : folder === 'trash' ? t('inbox.listTitleTrash')
                : t('inbox.listTitleAll')
              }}
            </h2>
            <span class="text-xs tabular-nums text-ink-4">
              {{ searchActive ? t('inbox.listFiltered', { count: matchedTotal }) : t('inbox.listCount', { count: `${emails.length}${hasMore ? '+' : ''}` }) }}
            </span>
          </div>
          <label class="relative block">
            <span class="sr-only">{{ t('inbox.search') }}</span>
            <svg class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" stroke-linecap="round" />
            </svg>
            <input
              v-model="searchQuery"
              class="w-full rounded-[12px] border border-line-2 bg-surface py-2.5 pl-9 pr-3 text-base outline-none transition placeholder:text-ink-5 focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm"
              type="search"
              :placeholder="t('inbox.searchPlaceholder')"
              autocomplete="off"
            />
          </label>
        </div>

        <p v-if="inboxError" class="mx-3 mt-3 shrink-0 rounded-[12px] bg-error-bg px-3 py-2.5 text-sm text-danger" role="alert">
          {{ inboxError }}
        </p>

        <div ref="listRef" class="lm-scroll min-h-0 flex-1 overflow-y-auto">
          <div v-if="inboxLoading" class="space-y-2 p-3">
            <div v-for="n in 6" :key="n" class="lm-skeleton h-[72px] rounded-[14px]"></div>
          </div>

          <div
            v-else-if="filteredEmails.length === 0"
            class="flex h-full min-h-[240px] flex-col items-center justify-center px-6 py-16 text-center"
          >
            <div class="mb-4 grid size-14 place-items-center rounded-2xl bg-chip text-ink-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                <path d="M4 6h16v12H4z" stroke-linejoin="round" />
                <path d="m4 8 8 6 8-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
            <p class="font-medium text-ink-2">
              {{ searchQuery.trim() ? t('inbox.noMatchTitle') : folder === 'unread' ? t('inbox.noUnreadTitle') : t('inbox.emptyTitle') }}
            </p>
            <p class="mt-2 max-w-[240px] text-sm leading-6 text-ink-4">
              {{
                searchQuery.trim()
                  ? t('inbox.noMatchHint')
                  : folder === 'unread'
                    ? t('inbox.noUnreadHint')
                    : t('inbox.emptyHint', { address: fullAddress })
              }}
            </p>
          </div>

          <ul v-else class="divide-y divide-line/70" role="listbox" :aria-label="t('inbox.emailList')">
            <li v-for="email in filteredEmails" :key="email.id">
              <button
                class="flex w-full gap-3 px-3 py-3.5 text-left transition hover:bg-surface-3"
                :class="selectedId === email.id ? 'bg-surface-3 shadow-[inset_3px_0_0_0_var(--lm-accent)]' : ''"
                type="button"
                role="option"
                :aria-selected="selectedId === email.id"
                :data-email-id="email.id"
                @click="openEmail(email.id)"
              >
                <span
                  class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold"
                  :class="email.isRead ? 'bg-chip text-ink-3' : 'bg-card-2 text-danger'"
                  aria-hidden="true"
                >{{ senderInitial(email) }}</span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-start justify-between gap-2">
                    <span
                      class="truncate text-sm"
                      :class="email.isRead ? 'font-medium text-ink-3' : 'font-semibold text-ink'"
                    >{{ displayName(email) }}{{ email.isStarred ? ' ★' : '' }}</span>
                    <span class="shrink-0 text-[11px] tabular-nums text-ink-5">{{ formatTime(email.receivedAt) }}</span>
                  </span>
                  <span class="mt-0.5 flex items-center gap-1.5">
                    <span
                      v-if="!email.isRead"
                      class="size-1.5 shrink-0 rounded-full bg-accent"
                      :aria-label="t('inbox.unreadDot')"
                    ></span>
                    <span
                      class="truncate text-sm"
                      :class="email.isRead ? 'text-ink-4' : 'font-medium text-ink-2'"
                    >{{ email.subject || t('inbox.noSubject') }}</span>
                  </span>
                  <span class="mt-0.5 block text-[11px] text-ink-5">{{ formatSize(email.size) }}</span>
                </span>
              </button>
            </li>
          </ul>

          <div v-if="hasMore && !searchQuery.trim()" class="p-3">
            <button
              class="w-full rounded-[12px] border border-line-2 bg-surface py-2.5 text-sm font-medium text-ink-2 transition hover:bg-surface-2 disabled:opacity-50 active:translate-y-px"
              type="button"
              :disabled="loadingMore"
              @click="loadMore"
            >{{ loadingMore ? t('inbox.loadingMore') : t('inbox.loadMore') }}</button>
          </div>
        </div>

        <p class="hidden shrink-0 border-t border-line px-3 py-2 text-[11px] text-ink-5 md:block">
          {{ t('inbox.shortcuts') }}
        </p>
      </section>

      <!-- Reading pane -->
      <section
        class="min-w-0 flex-1 flex-col bg-surface-2"
        :class="mobilePane === 'list' ? 'hidden md:flex' : 'flex'"
      >
        <div v-if="detailLoading" class="flex flex-1 items-center justify-center p-8">
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" :aria-label="t('inbox.loading')"></div>
        </div>

        <template v-else-if="selected">
          <div class="shrink-0 border-b border-line bg-canvas px-4 py-3 md:px-6">
            <div class="mb-3 flex items-start gap-2 md:mb-4">
              <button
                class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] text-ink-2 transition hover:bg-chip md:hidden"
                type="button"
                :aria-label="t('inbox.backToList')"
                @click="backToList"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M15 6 9 12l6 6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <h2 class="min-w-0 flex-1 text-xl font-semibold tracking-tight text-balance md:text-2xl">
                {{ selected.subject || t('inbox.noSubject') }}
              </h2>
              <div class="flex shrink-0 flex-wrap justify-end gap-1.5">
                <button class="rounded-full border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-surface" type="button" @click="patchEmail(selected.id, { isStarred: !selected.isStarred })">{{ selected.isStarred ? t('inbox.unstar') : t('inbox.star') }}</button>
                <button v-if="selected.folder !== 'archive'" class="rounded-full border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-surface" type="button" @click="patchEmail(selected.id, { folder: 'archive' })">{{ t('inbox.moveArchive') }}</button>
                <button v-else class="rounded-full border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-surface" type="button" @click="patchEmail(selected.id, { folder: 'inbox' })">{{ t('inbox.moveInbox') }}</button>
                <button v-if="selected.folder !== 'trash'" class="rounded-full border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-surface" type="button" @click="patchEmail(selected.id, { folder: 'trash' })">{{ t('inbox.moveTrash') }}</button>
                <button class="rounded-full border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-surface" type="button" @click="downloadEml(selected.id)">{{ t('inbox.downloadEml') }}</button>
                <button class="rounded-full bg-danger px-3.5 py-1.5 text-xs font-medium text-accent-ink transition hover:bg-danger-hover active:translate-y-px" type="button" @click="deleteEmail(selected.id)">{{ t('inbox.deleteEmail') }}</button>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <span
                class="grid size-10 shrink-0 place-items-center rounded-full bg-card-2 text-sm font-semibold text-danger"
                aria-hidden="true"
              >{{ senderInitial(selected) }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ displayName(selected) }}</p>
                <p class="truncate text-xs text-ink-4" :title="selected.sender">{{ selected.sender }}</p>
              </div>
              <div class="w-full text-xs text-ink-4 sm:w-auto sm:text-right">
                <p :title="formatFullTime(selected.receivedAt)">{{ formatFullTime(selected.receivedAt) }}</p>
                <p class="mt-0.5 tabular-nums">{{ formatSize(selected.size) }}</p>
              </div>
            </div>
            <dl v-if="selected.to?.length || selected.cc?.length || selected.messageId" class="mt-3 grid gap-1 text-xs text-ink-4">
              <div v-if="selected.to?.length" class="flex gap-2"><dt class="shrink-0 text-ink-5">{{ t('inbox.to') }}</dt><dd class="min-w-0 break-all">{{ selected.to.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ') }}</dd></div>
              <div v-if="selected.cc?.length" class="flex gap-2"><dt class="shrink-0 text-ink-5">{{ t('inbox.cc') }}</dt><dd class="min-w-0 break-all">{{ selected.cc.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ') }}</dd></div>
              <div v-if="selected.messageId" class="flex gap-2"><dt class="shrink-0 text-ink-5">{{ t('inbox.messageId') }}</dt><dd class="min-w-0 break-all font-mono text-[11px]">{{ selected.messageId }}</dd></div>
            </dl>
            <div v-if="selected.attachments?.length" class="mt-2 flex flex-wrap gap-1.5">
              <span class="text-[11px] text-ink-5">{{ t('inbox.attachments') }}:</span>
              <span v-for="(att, i) in selected.attachments" :key="i" class="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px]">{{ att.filename }} ({{ formatSize(att.size) }})</span>
            </div>
            <div v-if="selected.labels?.length" class="mt-2 flex flex-wrap gap-1">
              <span v-for="lab in selected.labels" :key="lab" class="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-2">{{ lab }}</span>
            </div>

            <div v-if="hasHtmlBody && hasTextBody" class="mt-3 flex w-fit gap-1 rounded-[10px] bg-surface-3 p-1">
              <button
                class="rounded-[8px] px-3 py-1 text-xs font-medium transition"
                :class="bodyMode === 'html' ? 'bg-surface shadow-sm text-ink' : 'text-ink-3'"
                type="button"
                @click="bodyMode = 'html'"
              >{{ t('inbox.htmlBody') }}</button>
              <button
                class="rounded-[8px] px-3 py-1 text-xs font-medium transition"
                :class="bodyMode === 'text' ? 'bg-surface shadow-sm text-ink' : 'text-ink-3'"
                type="button"
                @click="bodyMode = 'text'"
              >{{ t('inbox.textBody') }}</button>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
            <div
              v-if="bodyMode === 'html' && hasHtmlBody"
              class="mail-body mx-auto max-w-3xl"
              v-html="sanitizedHtml"
            ></div>
            <pre
              v-else
              class="lm-scroll mx-auto max-w-3xl whitespace-pre-wrap break-words font-sans text-[15px] leading-7 text-ink-2"
            >{{ selected.bodyText || t('inbox.noBody') }}</pre>
          </div>
        </template>

        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center"
        >
          <div class="mb-5 grid size-16 place-items-center rounded-[20px] bg-hero-glow text-ink-3">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M4 6h16v12H4z" stroke-linejoin="round" />
              <path d="m4 8 8 6 8-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          <p class="text-lg font-semibold tracking-tight">{{ t('inbox.noSelectionTitle') }}</p>
          <p class="mt-2 max-w-xs text-sm leading-6 text-ink-4">
            {{ t('inbox.noSelectionHint') }}
          </p>
        </div>
      </section>
    </div>

    <!-- Settings panel -->
    <Transition name="lm-fade">
      <div v-if="settingsOpen" class="fixed inset-0 z-[90] flex justify-end bg-ink/30" @click.self="settingsOpen = false">
        <div class="lm-slide-panel flex h-full w-full max-w-md flex-col border-l border-line bg-canvas shadow-[-12px_0_40px_rgba(41,65,53,0.08)]">
          <div class="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 class="text-lg font-semibold tracking-tight">{{ t('inbox.settings') }}</h2>
            <button class="rounded-full px-3 py-1.5 text-sm text-ink-3 hover:bg-chip" type="button" @click="settingsOpen = false">{{ t('inbox.close') }}</button>
          </div>
          <div class="lm-scroll min-h-0 flex-1 space-y-8 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <section>
            <h3 class="mb-2 text-sm font-semibold">{{ t('inbox.exportJson') }} / mbox</h3>
            <div class="flex flex-wrap gap-2">
              <button class="rounded-full border border-line-2 bg-surface px-3 py-2 text-xs font-medium" type="button" @click="exportMailbox('json')">{{ t('inbox.exportJson') }}</button>
              <button class="rounded-full border border-line-2 bg-surface px-3 py-2 text-xs font-medium" type="button" @click="exportMailbox('mbox')">{{ t('inbox.exportMbox') }}</button>
            </div>
          </section>
          <section>
            <h3 class="mb-1 text-sm font-semibold">{{ t('filters.title') }}</h3>
            <p class="mb-3 text-xs text-ink-4">{{ t('filters.hint') }}</p>
            <form class="grid gap-2" @submit.prevent="createFilter">
              <select v-model="filterField" class="rounded-[10px] border border-line-2 bg-surface px-3 py-2 text-sm">
                <option value="sender">{{ t('filters.fields.sender') }}</option>
                <option value="subject">{{ t('filters.fields.subject') }}</option>
                <option value="body">{{ t('filters.fields.body') }}</option>
              </select>
              <select v-model="filterOp" class="rounded-[10px] border border-line-2 bg-surface px-3 py-2 text-sm">
                <option value="contains">{{ t('filters.ops.contains') }}</option>
                <option value="equals">{{ t('filters.ops.equals') }}</option>
              </select>
              <input v-model="filterValue" class="rounded-[10px] border border-line-2 bg-surface px-3 py-2 text-sm" :placeholder="t('filters.value')" />
              <select v-model="filterAction" class="rounded-[10px] border border-line-2 bg-surface px-3 py-2 text-sm">
                <option value="star">{{ t('filters.actions.star') }}</option>
                <option value="archive">{{ t('filters.actions.archive') }}</option>
                <option value="mark_read">{{ t('filters.actions.mark_read') }}</option>
                <option value="delete">{{ t('filters.actions.delete') }}</option>
                <option value="label">{{ t('filters.actions.label') }}</option>
              </select>
              <input v-model="filterName" class="rounded-[10px] border border-line-2 bg-surface px-3 py-2 text-sm" :placeholder="t('filters.namePlaceholder')" />
              <p v-if="filterError" class="text-xs text-danger">{{ filterError }}</p>
              <button class="rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas disabled:opacity-60" type="submit" :disabled="filterSaving">{{ filterSaving ? t('filters.creating') : t('filters.create') }}</button>
            </form>
            <ul class="mt-4 space-y-2">
              <li v-if="filters.length === 0" class="text-xs text-ink-5">{{ t('filters.empty') }}</li>
              <li v-for="f in filters" :key="f.id" class="flex items-start justify-between gap-2 rounded-[12px] border border-line bg-surface p-3 text-xs">
                <div class="min-w-0">
                  <p class="font-medium text-ink">{{ f.matchField }} {{ f.matchOp }} “{{ f.matchValue }}” → {{ f.action }}</p>
                  <p v-if="f.name" class="mt-0.5 text-ink-4">{{ f.name }}</p>
                </div>
                <button class="shrink-0 text-danger" type="button" @click="deleteFilter(f.id)">{{ t('filters.remove') }}</button>
              </li>
            </ul>
          </section>
        </div>
        </div>
      </div>
    </Transition>

    <!-- Keyboard shortcuts help -->
    <Transition name="lm-fade">
      <div v-if="helpOpen" class="fixed inset-0 z-[90] flex items-center justify-center bg-ink/30 p-4" @click.self="helpOpen = false">
        <div class="lm-slide-panel w-full max-w-md rounded-[20px] border border-line bg-canvas p-6 shadow-[0_30px_80px_rgba(41,65,53,0.16)]">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-semibold tracking-tight">{{ t('keyboard.title') }}</h2>
            <button class="rounded-full px-3 py-1.5 text-sm text-ink-3 transition hover:bg-chip" type="button" @click="helpOpen = false">{{ t('keyboard.close') }}</button>
          </div>
          <p class="mb-4 text-sm text-ink-4">{{ t('keyboard.hint') }}</p>
          <ul class="space-y-2.5">
            <li v-for="(label, key) in {
              navigate: t('keyboard.navigate'),
              back: t('keyboard.back'),
              refresh: t('keyboard.refresh'),
              star: t('keyboard.star'),
              archive: t('keyboard.archive'),
              trash: t('keyboard.trash'),
              read: t('keyboard.read'),
              folder: t('keyboard.folder'),
              delete: t('keyboard.delete'),
              help: t('keyboard.help'),
              esc: t('keyboard.esc'),
            }" :key="key" class="flex items-baseline justify-between gap-4 text-sm">
              <span class="min-w-0 text-ink-2">{{ label }}</span>
              <kbd class="shrink-0 rounded-[8px] border border-line-2 bg-surface-2 px-2 py-0.5 font-sans text-xs text-ink-2">{{ key === 'folder' ? '1-5' : key.toUpperCase() }}</kbd>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </div>

  <div class="lm-noise" aria-hidden="true"></div>
</template>

<style scoped>
.mail-body {
  line-height: 1.7;
  color: var(--lm-ink-2);
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 15px;
}

.mail-body :deep(a) {
  color: var(--lm-accent-strong);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.mail-body :deep(img) {
  max-width: 100%;
  height: auto;
}

.mail-body :deep(table) {
  max-width: 100%;
  border-collapse: collapse;
}

.mail-body :deep(pre),
.mail-body :deep(code) {
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.mail-body :deep(blockquote) {
  margin: 0.75em 0;
  padding-left: 1em;
  border-left: 3px solid var(--lm-line);
  color: var(--lm-ink-3);
}

.mail-body :deep(p) {
  margin: 0.6em 0;
}

.mail-body :deep(h1),
.mail-body :deep(h2),
.mail-body :deep(h3) {
  margin: 1em 0 0.4em;
  line-height: 1.3;
  font-weight: 600;
  color: var(--lm-ink);
}
</style>

import { computed, ref } from 'vue'
import { normalizeLocalPart } from '../../shared/local-part'
import { gt, gte } from '../i18n'

export const domain = 'lemonhub.net'
export const apiBase = import.meta.env.VITE_API_BASE ?? ''
export const TURNSTILE_SITEKEY = '0x4AAAAAAEHG1eVxw5ySkmSQ'

const RECENT_KEY = 'lm-recent-mailboxes'
const TOKEN_PREFIX = 'lm-token-'
const DEVICE_KEY = 'lm-device-id'

export type Mailbox = { id: string; localPart: string; createdAt: string }

export const mailbox = ref<Mailbox | null>(null)
export const token = ref('')
export const recentMailboxes = ref<Mailbox[]>([])
export const inviteRequired = ref(false)

export const fullAddress = computed(() => (mailbox.value ? `${mailbox.value.localPart}@${domain}` : ''))

export class ApiError extends Error {
  readonly code: string | undefined
  constructor(code: string | undefined) {
    super(code ?? 'unknown')
    this.code = code
  }
}

export async function readErrorCode(response: Response): Promise<string | undefined> {
  const payload = (await response.json().catch(() => null)) as { code?: unknown } | null
  return typeof payload?.code === 'string' ? payload.code : undefined
}

export function apiErrorMessage(code: string | undefined, fallbackKey: string): string {
  if (code && gte(`errors.${code}`)) return gt(`errors.${code}` as never)
  return gt(fallbackKey as never)
}

export function deviceId(): string {
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

export function loadRecent() {
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

export function saveRecent(item: Mailbox) {
  const next = [item, ...recentMailboxes.value.filter((m) => m.id !== item.id)].slice(0, 8)
  recentMailboxes.value = next
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
}

export function removeRecent(id: string) {
  recentMailboxes.value = recentMailboxes.value.filter((m) => m.id !== id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recentMailboxes.value))
  sessionStorage.removeItem(TOKEN_PREFIX + id)
}

export function persistToken(id: string, value: string) {
  sessionStorage.setItem(TOKEN_PREFIX + id, value)
}

export function savedToken(id: string): string | null {
  return sessionStorage.getItem(TOKEN_PREFIX + id)
}

export function clearToken(id: string) {
  sessionStorage.removeItem(TOKEN_PREFIX + id)
}

/** Shared rules with server (`shared/local-part.ts`). */
export function validateLocalPartClient(raw: string): string | null {
  const result = normalizeLocalPart(raw)
  return result.ok ? null : apiErrorMessage(result.code, 'createForm.failed')
}

export async function loadHealth() {
  try {
    const response = await fetch(`${apiBase}/api/health`)
    if (!response.ok) return
    const data = (await response.json()) as { inviteRequired?: boolean; domain?: string }
    inviteRequired.value = Boolean(data.inviteRequired)
  } catch {
    /* ignore — form still works; server will enforce */
  }
}

export async function requestLogin(
  localPart: string,
  password: string,
  turnstileToken: string,
): Promise<{ mailbox: Mailbox; token: string }> {
  const response = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      localPart: localPart.trim(),
      password,
      'cf-turnstile-response': turnstileToken,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(await readErrorCode(response))
  return payload as { mailbox: Mailbox; token: string }
}

export async function requestCreateMailbox(input: {
  localPart: string
  password: string
  turnstileToken: string
  inviteCode?: string
}): Promise<{ mailbox: Mailbox; token: string }> {
  const response = await fetch(`${apiBase}/api/mailboxes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'device-id': deviceId() },
    body: JSON.stringify({
      localPart: input.localPart,
      password: input.password,
      'cf-turnstile-response': input.turnstileToken,
      ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(await readErrorCode(response))
  return {
    mailbox: { id: payload.id, localPart: payload.localPart, createdAt: payload.createdAt },
    token: payload.token,
  }
}

export function applySession(mb: Mailbox, sessionToken: string) {
  saveRecent(mb)
  token.value = sessionToken
  persistToken(mb.id, sessionToken)
  mailbox.value = mb
}

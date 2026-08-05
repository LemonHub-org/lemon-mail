<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DOMPurify from 'dompurify'
import heroImage from './assets/mail-routes-hero.png'

type Mailbox = { id: string; localPart: string; createdAt: string }
type EmailSummary = { id: string; sender: string; subject: string; size: number; isRead: boolean; receivedAt: string }
type EmailDetail = EmailSummary & { bodyText: string | null; bodyHtml: string | null }

const domain = 'lemonhub.net'
const apiBase = import.meta.env.VITE_API_BASE ?? ''

const view = ref<'manage' | 'login' | 'inbox'>('manage')
const mailboxes = ref<Mailbox[]>([])
const loading = ref(true)
const creating = ref(false)
const localPart = ref('')
const password = ref('')
const error = ref('')
const flash = ref('')

const loginMailbox = ref<Mailbox | null>(null)
const loginPassword = ref('')
const loginError = ref('')
const loggingIn = ref(false)

const token = ref('')
const emails = ref<EmailSummary[]>([])
const selected = ref<EmailDetail | null>(null)
const inboxLoading = ref(false)
const inboxError = ref('')
const quotaUsed = ref(0)
const quotaLimit = ref(10 * 1024 * 1024)
const total = ref(0)

const addressPreview = computed(() => `${localPart.value.trim() || 'hello'}@${domain}`)
const quotaPercent = computed(() => Math.min(Math.round((quotaUsed.value / quotaLimit.value) * 100), 100))
const quotaOver = computed(() => quotaPercent.value >= 80)

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function loadMailboxes() {
  loading.value = true
  try {
    const response = await fetch(`${apiBase}/api/mailboxes`)
    if (!response.ok) throw new Error('无法读取邮箱列表')
    mailboxes.value = await response.json()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '服务暂时不可用'
  } finally {
    loading.value = false
  }
}

async function createMailbox() {
  error.value = ''
  flash.value = ''
  if (!localPart.value.trim() || !password.value.trim()) {
    error.value = '请填写邮箱前缀和密码。'
    return
  }
  creating.value = true
  try {
    const response = await fetch(`${apiBase}/api/mailboxes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: localPart.value, password: password.value }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.message ?? '创建失败')
    mailboxes.value.unshift(payload)
    flash.value = `${payload.localPart}@${domain} 已创建。`
    localPart.value = ''
    password.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : '创建失败'
  } finally {
    creating.value = false
  }
}

async function deleteMailbox(id: string) {
  if (!confirm('确定删除该邮箱？其中所有邮件也会被删除。')) return
  const response = await fetch(`${apiBase}/api/mailboxes/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    error.value = '删除失败，请稍后重试。'
    return
  }
  mailboxes.value = mailboxes.value.filter((item) => item.id !== id)
}

function openInbox(mailbox: Mailbox) {
  loginMailbox.value = mailbox
  loginPassword.value = ''
  loginError.value = ''
  const saved = sessionStorage.getItem(`lm-token-${mailbox.id}`)
  if (saved) {
    token.value = saved
    enterInbox()
  } else {
    view.value = 'login'
  }
}

async function doLogin() {
  if (!loginMailbox.value) return
  loginError.value = ''
  loggingIn.value = true
  try {
    const response = await fetch(`${apiBase}/api/mailboxes/${loginMailbox.value.id}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: loginPassword.value }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.message ?? '登录失败')
    token.value = payload.token
    sessionStorage.setItem(`lm-token-${loginMailbox.value.id}`, payload.token)
    enterInbox()
  } catch (err) {
    loginError.value = err instanceof Error ? err.message : '登录失败'
  } finally {
    loggingIn.value = false
  }
}

async function enterInbox() {
  view.value = 'inbox'
  selected.value = null
  await loadInbox()
}

async function loadInbox() {
  if (!loginMailbox.value) return
  inboxLoading.value = true
  inboxError.value = ''
  try {
    const response = await fetch(`${apiBase}/api/mailboxes/${loginMailbox.value.id}/emails`, {
      headers: { authorization: `Bearer ${token.value}` },
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.message ?? '无法读取收件箱')
    emails.value = payload.emails
    quotaUsed.value = payload.quota.used
    quotaLimit.value = payload.quota.limit
    total.value = payload.total
  } catch (err) {
    inboxError.value = err instanceof Error ? err.message : '无法读取收件箱'
    if (inboxError.value.includes('登录')) logout()
  } finally {
    inboxLoading.value = false
  }
}

async function openEmail(emailId: string) {
  if (!loginMailbox.value) return
  try {
    const response = await fetch(`${apiBase}/api/mailboxes/${loginMailbox.value.id}/emails/${emailId}`, {
      headers: { authorization: `Bearer ${token.value}` },
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.message ?? '无法读取邮件')
    selected.value = payload
    const item = emails.value.find((e) => e.id === emailId)
    if (item) item.isRead = true
  } catch (err) {
    inboxError.value = err instanceof Error ? err.message : '无法读取邮件'
  }
}

async function deleteEmail(emailId: string) {
  if (!loginMailbox.value) return
  if (!confirm('确定删除这封邮件？')) return
  const response = await fetch(`${apiBase}/api/mailboxes/${loginMailbox.value.id}/emails/${emailId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token.value}` },
  })
  if (!response.ok) {
    inboxError.value = '删除失败，请稍后重试。'
    return
  }
  emails.value = emails.value.filter((e) => e.id !== emailId)
  const removedSize = selected.value?.id === emailId ? selected.value.size : 0
  if (selected.value?.id === emailId) selected.value = null
  quotaUsed.value = Math.max(quotaUsed.value - removedSize, 0)
}

function logout() {
  if (loginMailbox.value) sessionStorage.removeItem(`lm-token-${loginMailbox.value.id}`)
  token.value = ''
  loginMailbox.value = null
  view.value = 'manage'
  loadMailboxes()
}

const sanitizedHtml = computed(() => (selected.value?.bodyHtml ? DOMPurify.sanitize(selected.value.bodyHtml) : ''))

onMounted(loadMailboxes)
</script>

<template>
  <main class="overflow-hidden bg-[#f7f8f6] text-[#18201d]">
    <nav class="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 md:px-8" aria-label="主导航">
      <a class="flex items-center gap-2.5 font-semibold tracking-tight" href="#top" @click.prevent="view === 'inbox' && logout()">
        <span class="grid size-8 place-items-center rounded-[10px] bg-[#18201d] text-sm font-bold text-[#f7f8f6]">L</span>
        <span>Lemon Mail</span>
      </a>
      <a v-if="view === 'manage'" class="rounded-full bg-[#18201d] px-4 py-2 text-sm font-medium text-[#f7f8f6] transition hover:bg-[#33413b] active:translate-y-px" href="#manage">管理邮箱</a>
      <button v-else class="rounded-full border border-[#cfd5d1] px-4 py-2 text-sm font-medium text-[#33413b] transition hover:border-[#9ca9a2] hover:bg-white active:translate-y-px" type="button" @click="logout">返回管理页</button>
    </nav>

    <template v-if="view === 'manage'">
      <section id="top" class="relative mx-auto grid min-h-[calc(100dvh-72px)] max-w-7xl items-center gap-10 px-5 pb-14 pt-10 md:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:pb-20 lg:pt-16">
        <div class="relative z-10 max-w-xl">
          <p class="mb-6 text-sm font-medium tracking-wide text-[#d85e32]">你的域名，你的邮箱</p>
          <h1 class="text-5xl font-semibold tracking-[-0.06em] text-balance sm:text-6xl lg:text-7xl">让每一个身份，都有自己的地址。</h1>
          <p class="mt-6 max-w-md text-lg leading-8 text-[#59645f]">用 lemonhub.net 创建专属邮箱，邮件直接托管在本站，每个地址 10MB 配额。</p>
          <div class="mt-8 flex flex-wrap gap-3">
            <a class="rounded-full bg-[#e66d40] px-5 py-3 font-medium text-white shadow-[0_12px_30px_rgba(230,109,64,0.18)] transition hover:bg-[#ca5730] active:translate-y-px" href="#manage">创建一个邮箱</a>
            <a class="rounded-full border border-[#cfd5d1] px-5 py-3 font-medium text-[#33413b] transition hover:border-[#9ca9a2] hover:bg-white active:translate-y-px" href="#how">了解工作方式</a>
          </div>
        </div>
        <div class="relative mx-auto w-full max-w-[620px] lg:mr-0">
          <div class="absolute -inset-10 -z-10 rounded-full bg-[#e8efe8] blur-3xl"></div>
          <img class="aspect-[4/5] w-full rounded-[24px] object-cover shadow-[0_30px_80px_rgba(41,65,53,0.12)]" :src="heroImage" alt="多封信件汇聚于同一个域名的抽象纸艺画面" />
        </div>
      </section>

      <section class="border-y border-[#dce2de] bg-[#f1f4f1] py-8">
        <div class="mx-auto flex max-w-7xl flex-col gap-4 px-5 md:flex-row md:items-center md:justify-between md:px-8">
          <p class="text-sm font-medium text-[#59645f]">一个域名，不止一个身份。</p>
          <div class="flex flex-wrap gap-x-8 gap-y-2 text-sm text-[#33413b]">
            <span>邮箱别名</span><span>邮件托管</span><span>随时增删</span><span>你的 @lemonhub.net</span>
          </div>
        </div>
      </section>

      <section id="manage" class="mx-auto max-w-7xl px-5 py-20 md:px-8 lg:py-28">
        <div class="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p class="mb-4 text-sm font-medium tracking-wide text-[#d85e32]">邮箱管理</p>
            <h2 class="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">添加新地址，<br />不用开新账号。</h2>
            <p class="mt-5 max-w-sm leading-7 text-[#59645f]">每个地址独立配额，邮件托管在本站。用密码登录即可查看收件箱。</p>
          </div>

          <div class="rounded-[20px] border border-[#dce2de] bg-white p-5 shadow-[0_20px_50px_rgba(41,65,53,0.06)] sm:p-7">
            <form class="grid gap-5" @submit.prevent="createMailbox">
              <div>
                <label class="mb-2 block text-sm font-medium" for="local-part">邮箱前缀</label>
                <div class="flex overflow-hidden rounded-[12px] border border-[#cfd5d1] bg-[#fafbfa] focus-within:border-[#e66d40] focus-within:ring-2 focus-within:ring-[#e66d40]/20">
                  <input id="local-part" v-model="localPart" class="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none" placeholder="hello" autocomplete="off" />
                  <span class="flex items-center border-l border-[#dce2de] px-3 text-sm text-[#59645f]">@lemonhub.net</span>
                </div>
                <p class="mt-2 text-sm text-[#69746e]">将创建为 {{ addressPreview }}</p>
              </div>
              <div>
                <label class="mb-2 block text-sm font-medium" for="mailbox-password">收件箱密码</label>
                <input id="mailbox-password" v-model="password" class="w-full rounded-[12px] border border-[#cfd5d1] bg-[#fafbfa] px-4 py-3 outline-none transition focus:border-[#e66d40] focus:ring-2 focus:ring-[#e66d40]/20" type="password" placeholder="至少 8 位" autocomplete="new-password" />
                <p class="mt-2 text-sm text-[#69746e]">查看该邮箱的收件箱时需要输入，请妥善保管。</p>
              </div>
              <p v-if="error" class="rounded-[12px] bg-[#fff0ea] px-4 py-3 text-sm text-[#9b3718]" role="alert">{{ error }}</p>
              <p v-if="flash" class="rounded-[12px] bg-[#edf6ef] px-4 py-3 text-sm text-[#2e6c43]" role="status">{{ flash }}</p>
              <button class="w-full rounded-full bg-[#18201d] px-5 py-3 font-medium text-[#f7f8f6] transition hover:bg-[#33413b] disabled:cursor-not-allowed disabled:opacity-60 active:translate-y-px" type="submit" :disabled="creating">{{ creating ? '正在创建' : '创建邮箱' }}</button>
            </form>
          </div>
        </div>

        <div class="mt-16">
          <div class="mb-5 flex items-end justify-between gap-4">
            <div><h3 class="text-2xl font-semibold tracking-tight">现有地址</h3><p class="mt-1 text-sm text-[#69746e]">{{ mailboxes.length }} 个地址正在使用。</p></div>
            <button class="text-sm font-medium text-[#d85e32] underline-offset-4 hover:underline" type="button" @click="loadMailboxes">刷新</button>
          </div>
          <div v-if="loading" class="grid gap-3 sm:grid-cols-2">
            <div v-for="item in 2" :key="item" class="h-28 animate-pulse rounded-[16px] bg-[#e8ede9]"></div>
          </div>
          <p v-else-if="mailboxes.length === 0" class="rounded-[16px] bg-[#eef2ef] px-6 py-10 text-[#59645f]">还没有邮箱。用上面的表单创建你的第一个地址。</p>
          <div v-else class="grid gap-3 sm:grid-cols-2">
            <article v-for="mailbox in mailboxes" :key="mailbox.id" class="rounded-[16px] border border-[#dce2de] bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(41,65,53,0.07)]">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="font-medium">{{ mailbox.localPart }}@{{ domain }}</p>
                  <p class="mt-1 text-sm text-[#69746e]">创建于 {{ formatTime(mailbox.createdAt) }}</p>
                </div>
                <button class="shrink-0 text-sm text-[#9b3718] hover:underline" type="button" @click="deleteMailbox(mailbox.id)">删除</button>
              </div>
              <button class="mt-4 w-full rounded-full border border-[#cfd5d1] px-4 py-2 text-sm font-medium text-[#33413b] transition hover:border-[#9ca9a2] hover:bg-[#fafbfa] active:translate-y-px" type="button" @click="openInbox(mailbox)">查看收件箱</button>
            </article>
          </div>
        </div>
      </section>

      <section id="how" class="mx-auto max-w-7xl px-5 pb-24 md:px-8 lg:pb-32">
        <div class="grid gap-4 md:grid-cols-[1.4fr_0.9fr_1.1fr]">
          <article class="min-h-64 rounded-[20px] bg-[#dfe9e1] p-7"><p class="text-sm font-medium text-[#d85e32]">命名</p><h3 class="mt-12 text-3xl font-semibold tracking-tight">取一个名字</h3><p class="mt-3 max-w-xs leading-7 text-[#59645f]">工作、账单、社区或任何你想区分的场景。</p></article>
          <article class="min-h-64 rounded-[20px] bg-[#f4ddd3] p-7"><p class="text-sm font-medium text-[#d85e32]">托管</p><h3 class="mt-12 text-3xl font-semibold tracking-tight">邮件直达</h3><p class="mt-3 max-w-xs leading-7 text-[#59645f]">邮件直接进入本站收件箱，不经过第三方转发。</p></article>
          <article class="min-h-64 rounded-[20px] bg-[#e8ece9] p-7"><p class="text-sm font-medium text-[#d85e32]">管理</p><h3 class="mt-12 text-3xl font-semibold tracking-tight">保持掌控</h3><p class="mt-3 max-w-xs leading-7 text-[#59645f]">随时查看与清理，配额始终掌握在自己手里。</p></article>
        </div>
      </section>

      <footer class="border-t border-[#dce2de] px-5 py-8 md:px-8"><div class="mx-auto flex max-w-7xl flex-col gap-3 text-sm text-[#69746e] sm:flex-row sm:items-center sm:justify-between"><span>© 2026 Lemon Mail</span><span>邮箱服务使用 lemonhub.net</span></div></footer>
    </template>

    <template v-else-if="view === 'login'">
      <section class="mx-auto grid min-h-[calc(100dvh-72px)] max-w-md items-center px-5 py-16">
        <div class="rounded-[20px] border border-[#dce2de] bg-white p-7 shadow-[0_20px_50px_rgba(41,65,53,0.06)]">
          <p class="mb-1 text-sm font-medium tracking-wide text-[#d85e32]">收件箱登录</p>
          <h2 class="text-2xl font-semibold tracking-tight">{{ loginMailbox?.localPart }}@{{ domain }}</h2>
          <p class="mt-2 text-sm text-[#69746e]">输入该邮箱的密码查看邮件。</p>
          <form class="mt-6 grid gap-4" @submit.prevent="doLogin">
            <input v-model="loginPassword" class="w-full rounded-[12px] border border-[#cfd5d1] bg-[#fafbfa] px-4 py-3 outline-none transition focus:border-[#e66d40] focus:ring-2 focus:ring-[#e66d40]/20" type="password" placeholder="密码" autocomplete="current-password" />
            <p v-if="loginError" class="rounded-[12px] bg-[#fff0ea] px-4 py-3 text-sm text-[#9b3718]" role="alert">{{ loginError }}</p>
            <button class="w-full rounded-full bg-[#18201d] px-5 py-3 font-medium text-[#f7f8f6] transition hover:bg-[#33413b] disabled:cursor-not-allowed disabled:opacity-60 active:translate-y-px" type="submit" :disabled="loggingIn">{{ loggingIn ? '登录中' : '登录' }}</button>
          </form>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="mx-auto max-w-5xl px-5 py-12 md:px-8">
        <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="mb-1 text-sm font-medium tracking-wide text-[#d85e32]">收件箱</p>
            <h2 class="text-3xl font-semibold tracking-tight">{{ loginMailbox?.localPart }}@{{ domain }}</h2>
          </div>
          <div class="w-full max-w-xs">
            <div class="mb-1 flex items-center justify-between text-xs text-[#69746e]">
              <span>配额</span>
              <span>{{ formatSize(quotaUsed) }} / {{ formatSize(quotaLimit) }}</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-[#e8ede9]">
              <div class="h-full rounded-full transition-all" :class="quotaOver ? 'bg-[#d85e32]' : 'bg-[#2e6c43]'" :style="{ width: quotaPercent + '%' }"></div>
            </div>
          </div>
        </div>

        <p v-if="inboxError" class="mb-4 rounded-[12px] bg-[#fff0ea] px-4 py-3 text-sm text-[#9b3718]" role="alert">{{ inboxError }}</p>

        <div v-if="selected" class="rounded-[20px] border border-[#dce2de] bg-white p-6 shadow-[0_20px_50px_rgba(41,65,53,0.06)] sm:p-8">
          <div class="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-[#dce2de] pb-5">
            <div>
              <h3 class="text-2xl font-semibold tracking-tight">{{ selected.subject || '（无主题）' }}</h3>
              <p class="mt-2 text-sm text-[#69746e]">来自 {{ selected.sender }} · {{ formatTime(selected.receivedAt) }} · {{ formatSize(selected.size) }}</p>
            </div>
            <div class="flex gap-2">
              <button class="rounded-full border border-[#cfd5d1] px-4 py-2 text-sm font-medium text-[#33413b] transition hover:border-[#9ca9a2] hover:bg-[#fafbfa] active:translate-y-px" type="button" @click="selected = null">返回列表</button>
              <button class="rounded-full bg-[#9b3718] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#7d2a10] active:translate-y-px" type="button" @click="deleteEmail(selected.id)">删除</button>
            </div>
          </div>
          <div v-if="selected.bodyHtml && !selected.bodyText" class="mail-body" v-html="sanitizedHtml"></div>
          <div v-else class="whitespace-pre-wrap leading-7 text-[#33413b]">{{ selected.bodyText || '（无正文内容）' }}</div>
        </div>

        <div v-else>
          <div v-if="inboxLoading" class="grid gap-3">
            <div v-for="item in 3" :key="item" class="h-20 animate-pulse rounded-[16px] bg-[#e8ede9]"></div>
          </div>
          <p v-else-if="emails.length === 0" class="rounded-[16px] bg-[#eef2ef] px-6 py-14 text-center text-[#59645f]">还没有邮件，共 {{ total }} 封。发往这个地址的邮件会出现在这里。</p>
          <div v-else class="grid gap-3">
            <article v-for="email in emails" :key="email.id" class="cursor-pointer rounded-[16px] border border-[#dce2de] bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(41,65,53,0.07)]" @click="openEmail(email.id)">
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 items-center gap-3">
                  <span class="size-2 shrink-0 rounded-full" :class="email.isRead ? 'bg-transparent' : 'bg-[#e66d40]'" aria-hidden="true"></span>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium" :class="email.isRead ? 'text-[#69746e]' : 'text-[#18201d]'">{{ email.subject || '（无主题）' }}</p>
                    <p class="mt-0.5 truncate text-sm text-[#69746e]">{{ email.sender }}</p>
                  </div>
                </div>
                <div class="shrink-0 text-right text-xs text-[#69746e]">
                  <p>{{ formatTime(email.receivedAt) }}</p>
                  <p class="mt-1">{{ formatSize(email.size) }}</p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.mail-body {
  line-height: 1.7;
  color: #33413b;
  overflow-wrap: anywhere;
}
</style>

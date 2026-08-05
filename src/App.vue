<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import heroImage from './assets/mail-routes-hero.png'

type Mailbox = { id: string; localPart: string; destination: string; createdAt: string }

const domain = 'lemonhub.net'
const mailboxes = ref<Mailbox[]>([])
const loading = ref(true)
const creating = ref(false)
const localPart = ref('')
const destination = ref('')
const error = ref('')
const flash = ref('')

const addressPreview = computed(() => `${localPart.value.trim() || 'hello'}@${domain}`)

async function loadMailboxes() {
  loading.value = true
  try {
    const response = await fetch('/api/mailboxes')
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
  if (!localPart.value.trim() || !destination.value.trim()) {
    error.value = '请填写邮箱前缀和收件地址。'
    return
  }
  creating.value = true
  try {
    const response = await fetch('/api/mailboxes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPart: localPart.value, destination: destination.value }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.message ?? '创建失败')
    mailboxes.value.unshift(payload)
    flash.value = `${payload.localPart}@${domain} 已创建。`
    localPart.value = ''
    destination.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : '创建失败'
  } finally {
    creating.value = false
  }
}

async function deleteMailbox(id: string) {
  const response = await fetch(`/api/mailboxes/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    error.value = '删除失败，请稍后重试。'
    return
  }
  mailboxes.value = mailboxes.value.filter((item) => item.id !== id)
}

onMounted(loadMailboxes)
</script>

<template>
  <main class="overflow-hidden bg-[#f7f8f6] text-[#18201d]">
    <nav class="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 md:px-8" aria-label="主导航">
      <a class="flex items-center gap-2.5 font-semibold tracking-tight" href="#top">
        <span class="grid size-8 place-items-center rounded-[10px] bg-[#18201d] text-sm font-bold text-[#f7f8f6]">L</span>
        <span>Lemon Mail</span>
      </a>
      <a class="rounded-full bg-[#18201d] px-4 py-2 text-sm font-medium text-[#f7f8f6] transition hover:bg-[#33413b] active:translate-y-px" href="#manage">管理邮箱</a>
    </nav>

    <section id="top" class="relative mx-auto grid min-h-[calc(100dvh-72px)] max-w-7xl items-center gap-10 px-5 pb-14 pt-10 md:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:pb-20 lg:pt-16">
      <div class="relative z-10 max-w-xl">
        <p class="mb-6 text-sm font-medium tracking-wide text-[#d85e32]">你的域名，你的邮箱</p>
        <h1 class="text-5xl font-semibold tracking-[-0.06em] text-balance sm:text-6xl lg:text-7xl">让每一个身份，都有自己的地址。</h1>
        <p class="mt-6 max-w-md text-lg leading-8 text-[#59645f]">用 lemonhub.net 创建、转发并管理专属邮箱。名字不设限，收件箱始终在你手里。</p>
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
          <span>邮箱别名</span><span>自动转发</span><span>随时增删</span><span>你的 @lemonhub.net</span>
        </div>
      </div>
    </section>

    <section id="manage" class="mx-auto max-w-7xl px-5 py-20 md:px-8 lg:py-28">
      <div class="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div>
          <p class="mb-4 text-sm font-medium tracking-wide text-[#d85e32]">邮箱管理</p>
          <h2 class="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">添加新地址，<br />不用开新账号。</h2>
          <p class="mt-5 max-w-sm leading-7 text-[#59645f]">每个地址都能转发到你常用的收件箱。为项目、注册和合作留出清晰的边界。</p>
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
              <label class="mb-2 block text-sm font-medium" for="destination">转发至</label>
              <input id="destination" v-model="destination" class="w-full rounded-[12px] border border-[#cfd5d1] bg-[#fafbfa] px-4 py-3 outline-none transition focus:border-[#e66d40] focus:ring-2 focus:ring-[#e66d40]/20" type="email" placeholder="you@example.com" autocomplete="email" />
              <p class="mt-2 text-sm text-[#69746e]">收到的邮件会安全地发送到这个地址。</p>
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
            <div class="flex items-start justify-between gap-3"><div><p class="font-medium">{{ mailbox.localPart }}@{{ domain }}</p><p class="mt-2 truncate text-sm text-[#69746e]">转发至 {{ mailbox.destination }}</p></div><button class="shrink-0 text-sm text-[#9b3718] hover:underline" type="button" @click="deleteMailbox(mailbox.id)">删除</button></div>
          </article>
        </div>
      </div>
    </section>

    <section id="how" class="mx-auto max-w-7xl px-5 pb-24 md:px-8 lg:pb-32">
      <div class="grid gap-4 md:grid-cols-[1.4fr_0.9fr_1.1fr]">
        <article class="min-h-64 rounded-[20px] bg-[#dfe9e1] p-7"><p class="text-sm font-medium text-[#d85e32]">命名</p><h3 class="mt-12 text-3xl font-semibold tracking-tight">取一个名字</h3><p class="mt-3 max-w-xs leading-7 text-[#59645f]">工作、账单、社区或任何你想区分的场景。</p></article>
        <article class="min-h-64 rounded-[20px] bg-[#f4ddd3] p-7"><p class="text-sm font-medium text-[#d85e32]">转发</p><h3 class="mt-12 text-3xl font-semibold tracking-tight">设定去向</h3><p class="mt-3 max-w-xs leading-7 text-[#59645f]">邮件转发到已有收件箱，不改变你的使用习惯。</p></article>
        <article class="min-h-64 rounded-[20px] bg-[#e8ece9] p-7"><p class="text-sm font-medium text-[#d85e32]">管理</p><h3 class="mt-12 text-3xl font-semibold tracking-tight">保持掌控</h3><p class="mt-3 max-w-xs leading-7 text-[#59645f]">不需要时立即移除地址，让每个入口都清清楚楚。</p></article>
      </div>
    </section>

    <footer class="border-t border-[#dce2de] px-5 py-8 md:px-8"><div class="mx-auto flex max-w-7xl flex-col gap-3 text-sm text-[#69746e] sm:flex-row sm:items-center sm:justify-between"><span>© 2026 Lemon Mail</span><span>邮箱服务使用 lemonhub.net</span></div></footer>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { useAppI18n, setLocale, type AppLocale } from './i18n'
import { applyTheme, type Theme } from './theme'
import { parseTabEvent, type TabEvent } from './tabs'
import { view } from './state/app'
import { loadHealth, loadRecent, mailbox } from './state/session'
import { logout, syncInboxFromTab } from './state/inbox'
import LandingView from './views/LandingView.vue'
import InboxView from './views/InboxView.vue'

const { t, locale } = useAppI18n()

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let installPrompt: BeforeInstallPromptEvent | null = null
const installVisible = ref(false)
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
  window.addEventListener('storage', onStorage)
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
})

onUnmounted(() => {
  window.removeEventListener('storage', onStorage)
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.removeEventListener('appinstalled', onAppInstalled)
})
</script>

<template>
  <a
    href="#top"
    class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink"
  >{{ t('nav.skip') }}</a>

  <LandingView v-if="view === 'landing'" :install-visible="installVisible" @install="installApp" />
  <InboxView v-else />

  <div class="lm-noise" aria-hidden="true"></div>
</template>

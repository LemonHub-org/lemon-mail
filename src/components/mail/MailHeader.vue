<script setup lang="ts">
import { useAppI18n } from '../../i18n'
import { fullAddress } from '../../state/session'
import { copyAddress, copyHint, logout, refreshInbox, refreshing, sidebarOpen } from '../../state/inbox'
import LemonMark from '../LemonMark.vue'
import LocaleSwitcher from '../LocaleSwitcher.vue'
import ThemeSwitcher from '../ThemeSwitcher.vue'
import { LogOut, Menu, RefreshCw, Settings } from 'lucide-vue-next'

const { t } = useAppI18n()

const emit = defineEmits<{ openSettings: [] }>()
</script>

<template>
  <header class="z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-3 border-b border-line bg-canvas px-3 pt-[env(safe-area-inset-top)] md:px-5">
    <button
      class="grid size-9 place-items-center text-ink-2 transition hover:text-ink md:hidden"
      type="button"
      :aria-label="t('inbox.openMenu')"
      @click="sidebarOpen = true"
    >
      <Menu :size="18" :stroke-width="1.75" aria-hidden="true" />
    </button>

    <div class="flex min-w-0 items-baseline gap-3">
      <LemonMark :size="15" />
      <button
        class="hidden truncate font-mono text-xs text-ink-4 underline-offset-4 transition hover:text-ink hover:underline sm:inline"
        type="button"
        :title="t('inbox.copyAddress')"
        @click="copyAddress"
      >{{ copyHint || fullAddress }}</button>
    </div>

    <div class="ml-auto flex items-center gap-1 sm:gap-2">
      <button
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ink-3 transition hover:text-ink disabled:opacity-50"
        type="button"
        :disabled="refreshing"
        @click="refreshInbox"
      >
        <RefreshCw :size="14" :stroke-width="1.75" :class="refreshing ? 'animate-spin' : ''" aria-hidden="true" />
        <span class="hidden sm:inline">{{ refreshing ? t('inbox.refreshing') : t('inbox.refresh') }}</span>
      </button>
      <button
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ink-3 transition hover:text-ink"
        type="button"
        @click="emit('openSettings')"
      >
        <Settings :size="14" :stroke-width="1.75" aria-hidden="true" />
        <span class="hidden sm:inline">{{ t('inbox.settings') }}</span>
      </button>
      <span class="mx-1 hidden h-4 w-px bg-line-2 md:block" aria-hidden="true"></span>
      <div class="hidden items-center gap-2 md:flex">
        <LocaleSwitcher />
        <ThemeSwitcher />
        <button
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ink-3 transition hover:text-ink"
          type="button"
          @click="logout(true)"
        >
          <LogOut :size="14" :stroke-width="1.75" aria-hidden="true" />
          {{ t('inbox.logout') }}
        </button>
      </div>
    </div>
  </header>
</template>

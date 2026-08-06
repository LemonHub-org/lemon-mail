<script setup lang="ts">
import { computed } from 'vue'
import { useAppI18n } from '../../i18n'
import { fullAddress } from '../../state/session'
import {
  copyAddress,
  copyHint,
  deleteMailbox,
  deletingMailbox,
  folder,
  folderCounts,
  logout,
  quotaLimit,
  quotaOver,
  quotaPercent,
  quotaUsed,
  sidebarOpen,
  starredCount,
  switchFolder,
  unread,
  type Folder,
} from '../../state/inbox'
import { formatSize } from '../../utils/format'
import LocaleSwitcher from '../LocaleSwitcher.vue'
import ThemeSwitcher from '../ThemeSwitcher.vue'
import { Archive, CircleDot, Copy, Inbox, LogOut, Star, Trash2, X } from 'lucide-vue-next'

const { t } = useAppI18n()

const items = computed(() => [
  { key: 'inbox' as Folder, label: t('inbox.inbox'), icon: Inbox, count: folderCounts.value.inbox ?? 0 },
  { key: 'unread' as Folder, label: t('inbox.unread'), icon: CircleDot, count: unread.value },
  { key: 'starred' as Folder, label: t('inbox.starred'), icon: Star, count: starredCount.value },
  { key: 'archive' as Folder, label: t('inbox.archive'), icon: Archive, count: folderCounts.value.archive ?? 0 },
  { key: 'trash' as Folder, label: t('inbox.trash'), icon: Trash2, count: folderCounts.value.trash ?? 0 },
])
</script>

<template>
  <aside
    class="absolute inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col border-r border-line bg-canvas transition-transform md:static md:z-0 md:translate-x-0"
    :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
  >
    <div class="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
      <span class="lm-label">{{ t('inbox.folders') }}</span>
      <button class="grid size-8 place-items-center text-ink-3" type="button" :aria-label="t('inbox.close')" @click="sidebarOpen = false">
        <X :size="16" :stroke-width="1.75" aria-hidden="true" />
      </button>
    </div>

    <nav class="flex flex-col px-3 py-3" :aria-label="t('inbox.folderNav')">
      <button
        v-for="item in items"
        :key="item.key"
        class="group relative flex items-center justify-between px-3 py-2.5 text-left text-sm transition"
        :class="folder === item.key ? 'font-semibold text-ink' : 'text-ink-3 hover:text-ink'"
        type="button"
        @click="switchFolder(item.key)"
      >
        <span
          v-if="folder === item.key"
          class="absolute left-0 top-1/2 size-2 -translate-y-1/2 bg-accent"
          aria-hidden="true"
        ></span>
        <span class="flex items-center gap-2.5">
          <component :is="item.icon" :size="15" :stroke-width="1.75" aria-hidden="true" />
          {{ item.label }}
        </span>
        <span
          class="font-mono text-xs tabular-nums"
          :class="item.key === 'unread' && unread > 0 && folder !== 'unread' ? 'text-accent-strong' : 'text-ink-5'"
        >{{ item.count }}</span>
      </button>
    </nav>

    <div class="mt-auto space-y-5 border-t border-line p-4">
      <div>
        <div class="mb-2 flex items-baseline justify-between text-xs text-ink-4">
          <span class="lm-label">{{ t('inbox.storage') }}</span>
          <span class="font-mono tabular-nums">{{ formatSize(quotaUsed) }} / {{ formatSize(quotaLimit) }}</span>
        </div>
        <div class="h-0.5 bg-chip">
          <div
            class="h-full transition-all duration-300"
            :class="quotaOver ? 'bg-danger' : 'bg-accent-strong'"
            :style="{ width: quotaPercent + '%' }"
          ></div>
        </div>
        <p v-if="quotaOver" class="mt-2 text-xs text-danger">{{ t('inbox.quotaWarning') }}</p>
      </div>

      <div class="border-l-2 border-accent pl-3">
        <p class="lm-label">{{ t('inbox.currentAddress') }}</p>
        <p class="mt-1.5 truncate font-mono text-sm">{{ fullAddress }}</p>
        <button
          class="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-ink-3 underline-offset-4 transition hover:text-ink hover:underline"
          type="button"
          @click="copyAddress"
        >
          <Copy :size="11" :stroke-width="1.75" aria-hidden="true" />
          {{ copyHint || t('inbox.copyToClipboard') }}
        </button>
      </div>

      <button
        class="w-full text-left text-xs font-medium text-danger underline-offset-4 transition hover:underline disabled:opacity-50"
        type="button"
        :disabled="deletingMailbox"
        @click="deleteMailbox"
      >{{ deletingMailbox ? t('inbox.deletingMailbox') : t('inbox.deleteMailbox') }}</button>
    </div>

    <div class="flex items-center justify-between gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <LocaleSwitcher />
      <ThemeSwitcher />
      <button
        class="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-ink-3 transition hover:text-ink"
        type="button"
        @click="logout(true)"
      >
        <LogOut :size="14" :stroke-width="1.75" aria-hidden="true" />
        {{ t('inbox.logout') }}
      </button>
    </div>
  </aside>
</template>

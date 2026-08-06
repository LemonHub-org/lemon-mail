<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useAppI18n } from '../../i18n'
import {
  emails,
  filteredEmails,
  folder,
  hasMore,
  inboxError,
  inboxLoading,
  loadMore,
  loadingMore,
  matchedTotal,
  mobilePane,
  openEmail,
  searchActive,
  searchQuery,
  selectedId,
} from '../../state/inbox'
import { fullAddress } from '../../state/session'
import MailListItem from './MailListItem.vue'
import { Mail, Search } from 'lucide-vue-next'

const { t } = useAppI18n()

const listRef = ref<HTMLElement | null>(null)

watch(selectedId, async (id) => {
  if (!id) return
  await nextTick()
  const el = listRef.value?.querySelector(`[data-email-id="${id}"]`) as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <section
    class="flex w-full min-w-0 flex-col border-r border-line bg-canvas md:w-[360px] md:shrink-0 lg:w-[400px]"
    :class="mobilePane === 'detail' ? 'hidden md:flex' : 'flex'"
  >
    <div class="shrink-0 border-b border-line px-4 pb-3 pt-3.5">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="text-sm font-semibold tracking-tight">
          {{
            folder === 'unread' ? t('inbox.listTitleUnread')
            : folder === 'starred' ? t('inbox.listTitleStarred')
            : folder === 'archive' ? t('inbox.listTitleArchive')
            : folder === 'trash' ? t('inbox.listTitleTrash')
            : t('inbox.listTitleAll')
          }}
        </h2>
        <span class="font-mono text-xs tabular-nums text-ink-5">
          {{ searchActive ? t('inbox.listFiltered', { count: matchedTotal }) : t('inbox.listCount', { count: `${emails.length}${hasMore ? '+' : ''}` }) }}
        </span>
      </div>
      <label class="relative block">
        <span class="sr-only">{{ t('inbox.search') }}</span>
        <Search :size="14" :stroke-width="1.75" class="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-ink-5" aria-hidden="true" />
        <input
          v-model="searchQuery"
          class="w-full border-b border-line-2 bg-transparent py-2 pl-6 pr-2 text-sm outline-none transition placeholder:text-ink-5 focus:border-ink"
          type="search"
          :placeholder="t('inbox.searchPlaceholder')"
          autocomplete="off"
        />
      </label>
    </div>

    <p v-if="inboxError" class="mx-4 mt-3 shrink-0 border-l-2 border-danger bg-error-bg px-3 py-2.5 text-sm text-danger" role="alert">
      {{ inboxError }}
    </p>

    <div ref="listRef" class="lm-scroll min-h-0 flex-1 overflow-y-auto">
      <div v-if="inboxLoading" class="space-y-2 p-4">
        <div v-for="n in 6" :key="n" class="lm-skeleton h-[68px]"></div>
      </div>

      <div
        v-else-if="filteredEmails.length === 0"
        class="flex h-full min-h-[240px] flex-col items-center justify-center px-6 py-16 text-center"
      >
        <Mail :size="28" :stroke-width="1.25" class="mb-4 text-ink-5" aria-hidden="true" />
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

      <ul v-else class="divide-y divide-line" role="listbox" :aria-label="t('inbox.emailList')">
        <li v-for="email in filteredEmails" :key="email.id">
          <MailListItem :email="email" @open="openEmail" />
        </li>
      </ul>

      <div v-if="hasMore && !searchQuery.trim()" class="p-4">
        <button
          class="w-full border border-line-2 py-2.5 text-sm font-medium text-ink-2 transition hover:border-ink hover:text-ink disabled:opacity-50"
          type="button"
          :disabled="loadingMore"
          @click="loadMore"
        >{{ loadingMore ? t('inbox.loadingMore') : t('inbox.loadMore') }}</button>
      </div>
    </div>

    <p class="hidden shrink-0 border-t border-line px-4 py-2 font-mono text-[11px] text-ink-5 md:block">
      {{ t('inbox.shortcuts') }}
    </p>
  </section>
</template>

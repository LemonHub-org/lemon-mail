<script setup lang="ts">
import { useAppI18n } from '../../i18n'
import { domain, recentMailboxes, removeRecent } from '../../state/session'
import { pickRecent } from '../../state/landing'
import { X } from 'lucide-vue-next'

const { t } = useAppI18n()
</script>

<template>
  <div v-if="recentMailboxes.length" class="mt-12">
    <div class="mb-3 flex items-baseline justify-between gap-4">
      <h3 class="lm-label">{{ t('recent.heading') }}</h3>
      <span class="text-xs text-ink-5">{{ t('recent.note') }}</span>
    </div>
    <ul class="border-t border-line">
      <li v-for="item in recentMailboxes" :key="item.id" class="group flex items-center border-b border-line">
        <button
          class="min-w-0 flex-1 py-3.5 text-left transition group-hover:bg-surface-2"
          type="button"
          :title="t('recent.clickToFill')"
          @click="pickRecent(item)"
        >
          <span class="block truncate font-mono text-sm px-1">{{ item.localPart }}@{{ domain }}</span>
        </button>
        <button
          class="mr-1 grid size-7 shrink-0 place-items-center text-ink-5 transition hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          type="button"
          :title="t('recent.removeTitle')"
          :aria-label="t('recent.removeTitle')"
          @click="removeRecent(item.id)"
        >
          <X :size="14" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>

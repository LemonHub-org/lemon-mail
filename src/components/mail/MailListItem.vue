<script setup lang="ts">
import { useAppI18n } from '../../i18n'
import { selectedId, type EmailSummary } from '../../state/inbox'
import { displayName, formatSize, formatTime, senderInitial } from '../../utils/format'
import { Star } from 'lucide-vue-next'

const { t } = useAppI18n()

defineProps<{ email: EmailSummary }>()
const emit = defineEmits<{ open: [id: string] }>()
</script>

<template>
  <button
    class="flex w-full gap-3 px-4 py-3.5 text-left transition hover:bg-surface-2"
    :class="selectedId === email.id ? 'bg-surface-2 shadow-[inset_2px_0_0_0_var(--lm-accent)]' : ''"
    type="button"
    role="option"
    :aria-selected="selectedId === email.id"
    :data-email-id="email.id"
    @click="emit('open', email.id)"
  >
    <span
      class="grid size-8 shrink-0 place-items-center font-mono text-xs"
      :class="email.isRead ? 'bg-chip text-ink-3' : 'bg-accent text-accent-ink font-semibold'"
      aria-hidden="true"
    >{{ senderInitial(email) }}</span>
    <span class="min-w-0 flex-1">
      <span class="flex items-baseline justify-between gap-2">
        <span
          class="flex min-w-0 items-center gap-1 truncate text-sm"
          :class="email.isRead ? 'text-ink-3' : 'font-semibold text-ink'"
        >
          {{ displayName(email) }}
          <Star v-if="email.isStarred" :size="11" :stroke-width="0" class="shrink-0 fill-accent-strong text-accent-strong" aria-hidden="true" />
        </span>
        <span class="shrink-0 font-mono text-[11px] tabular-nums text-ink-5">{{ formatTime(email.receivedAt) }}</span>
      </span>
      <span class="mt-0.5 flex items-center gap-1.5">
        <span
          v-if="!email.isRead"
          class="size-1.5 shrink-0 bg-accent"
          :aria-label="t('inbox.unreadDot')"
        ></span>
        <span
          class="truncate text-[13px]"
          :class="email.isRead ? 'text-ink-4' : 'text-ink-2'"
        >{{ email.subject || t('inbox.noSubject') }}</span>
      </span>
      <span class="mt-0.5 block font-mono text-[11px] text-ink-5">{{ formatSize(email.size) }}</span>
    </span>
  </button>
</template>

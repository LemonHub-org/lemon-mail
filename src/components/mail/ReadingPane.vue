<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { useAppI18n } from '../../i18n'
import {
  backToList,
  bodyMode,
  deleteEmail,
  detailLoading,
  downloadEml,
  mobilePane,
  patchEmail,
  selected,
} from '../../state/inbox'
import { displayName, formatFullTime, formatSize, senderInitial } from '../../utils/format'
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  Download,
  Mail,
  Star,
  StarOff,
  Trash2,
  Undo2,
} from 'lucide-vue-next'

const { t } = useAppI18n()

const sanitizedHtml = computed(() => {
  if (!selected.value?.bodyHtml) return ''
  return DOMPurify.sanitize(selected.value.bodyHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
  })
})

const hasHtmlBody = computed(() => Boolean(selected.value?.bodyHtml))
const hasTextBody = computed(() => Boolean(selected.value?.bodyText))
</script>

<template>
  <section
    class="min-w-0 flex-1 flex-col bg-canvas"
    :class="mobilePane === 'list' ? 'hidden md:flex' : 'flex'"
  >
    <div v-if="detailLoading" class="flex flex-1 items-center justify-center p-8">
      <div class="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent-strong" :aria-label="t('inbox.loading')"></div>
    </div>

    <template v-else-if="selected">
      <div class="shrink-0 border-b border-line px-4 py-4 md:px-8 md:py-5">
        <div class="mb-4 flex items-start gap-3">
          <button
            class="mt-1 grid size-8 shrink-0 place-items-center text-ink-2 transition hover:text-ink md:hidden"
            type="button"
            :aria-label="t('inbox.backToList')"
            @click="backToList"
          >
            <ChevronLeft :size="18" :stroke-width="1.75" aria-hidden="true" />
          </button>
          <h2 class="min-w-0 flex-1 text-xl font-semibold leading-snug tracking-tight text-balance md:text-2xl">
            {{ selected.subject || t('inbox.noSubject') }}
          </h2>
        </div>

        <div class="flex flex-wrap items-center gap-x-1 gap-y-1.5">
          <button
            class="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium transition"
            :class="selected.isStarred ? 'text-accent-strong' : 'text-ink-3 hover:text-ink'"
            type="button"
            @click="patchEmail(selected.id, { isStarred: !selected.isStarred })"
          >
            <StarOff v-if="selected.isStarred" :size="13" :stroke-width="1.75" aria-hidden="true" />
            <Star v-else :size="13" :stroke-width="1.75" aria-hidden="true" />
            {{ selected.isStarred ? t('inbox.unstar') : t('inbox.star') }}
          </button>
          <button
            v-if="selected.folder !== 'archive'"
            class="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-3 transition hover:text-ink"
            type="button"
            @click="patchEmail(selected.id, { folder: 'archive' })"
          >
            <Archive :size="13" :stroke-width="1.75" aria-hidden="true" />
            {{ t('inbox.moveArchive') }}
          </button>
          <button
            v-else
            class="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-3 transition hover:text-ink"
            type="button"
            @click="patchEmail(selected.id, { folder: 'inbox' })"
          >
            <ArchiveRestore :size="13" :stroke-width="1.75" aria-hidden="true" />
            {{ t('inbox.moveInbox') }}
          </button>
          <button
            v-if="selected.folder !== 'trash'"
            class="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-3 transition hover:text-ink"
            type="button"
            @click="patchEmail(selected.id, { folder: 'trash' })"
          >
            <Trash2 :size="13" :stroke-width="1.75" aria-hidden="true" />
            {{ t('inbox.moveTrash') }}
          </button>
          <button
            v-else
            class="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-3 transition hover:text-ink"
            type="button"
            @click="patchEmail(selected.id, { folder: 'inbox' })"
          >
            <Undo2 :size="13" :stroke-width="1.75" aria-hidden="true" />
            {{ t('inbox.moveInbox') }}
          </button>
          <button
            class="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-3 transition hover:text-ink"
            type="button"
            @click="downloadEml(selected.id)"
          >
            <Download :size="13" :stroke-width="1.75" aria-hidden="true" />
            {{ t('inbox.downloadEml') }}
          </button>
          <button
            class="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-danger transition hover:text-danger-hover"
            type="button"
            @click="deleteEmail(selected.id)"
          >
            <Trash2 :size="13" :stroke-width="1.75" aria-hidden="true" />
            {{ t('inbox.deleteEmail') }}
          </button>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <span
            class="grid size-9 shrink-0 place-items-center bg-accent font-mono text-sm font-semibold text-accent-ink"
            aria-hidden="true"
          >{{ senderInitial(selected) }}</span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ displayName(selected) }}</p>
            <p class="truncate font-mono text-xs text-ink-4" :title="selected.sender">{{ selected.sender }}</p>
          </div>
          <div class="w-full text-xs text-ink-4 sm:w-auto sm:text-right">
            <p :title="formatFullTime(selected.receivedAt)">{{ formatFullTime(selected.receivedAt) }}</p>
            <p class="mt-0.5 font-mono tabular-nums">{{ formatSize(selected.size) }}</p>
          </div>
        </div>
        <dl v-if="selected.to?.length || selected.cc?.length || selected.messageId" class="mt-3 grid gap-1 text-xs text-ink-4">
          <div v-if="selected.to?.length" class="flex gap-2"><dt class="shrink-0 text-ink-5">{{ t('inbox.to') }}</dt><dd class="min-w-0 break-all">{{ selected.to.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ') }}</dd></div>
          <div v-if="selected.cc?.length" class="flex gap-2"><dt class="shrink-0 text-ink-5">{{ t('inbox.cc') }}</dt><dd class="min-w-0 break-all">{{ selected.cc.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ') }}</dd></div>
          <div v-if="selected.messageId" class="flex gap-2"><dt class="shrink-0 text-ink-5">{{ t('inbox.messageId') }}</dt><dd class="min-w-0 break-all font-mono text-[11px]">{{ selected.messageId }}</dd></div>
        </dl>
        <div v-if="selected.attachments?.length" class="mt-2 flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] text-ink-5">{{ t('inbox.attachments') }}:</span>
          <span v-for="(att, i) in selected.attachments" :key="i" class="border border-line px-2 py-0.5 font-mono text-[11px]">{{ att.filename }} ({{ formatSize(att.size) }})</span>
        </div>
        <div v-if="selected.labels?.length" class="mt-2 flex flex-wrap gap-1">
          <span v-for="lab in selected.labels" :key="lab" class="bg-surface-3 px-2 py-0.5 text-[11px] text-ink-2">{{ lab }}</span>
        </div>

        <div v-if="hasHtmlBody && hasTextBody" class="mt-3 flex w-fit gap-4 border-b border-line">
          <button
            class="-mb-px border-b pb-1.5 text-xs font-medium transition"
            :class="bodyMode === 'html' ? 'border-ink text-ink' : 'border-transparent text-ink-4 hover:text-ink'"
            type="button"
            @click="bodyMode = 'html'"
          >{{ t('inbox.htmlBody') }}</button>
          <button
            class="-mb-px border-b pb-1.5 text-xs font-medium transition"
            :class="bodyMode === 'text' ? 'border-ink text-ink' : 'border-transparent text-ink-4 hover:text-ink'"
            type="button"
            @click="bodyMode = 'text'"
          >{{ t('inbox.textBody') }}</button>
        </div>
      </div>

      <div class="lm-scroll min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
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
      <Mail :size="32" :stroke-width="1" class="mb-5 text-ink-5" aria-hidden="true" />
      <p class="text-lg font-semibold tracking-tight">{{ t('inbox.noSelectionTitle') }}</p>
      <p class="mt-2 max-w-xs text-sm leading-6 text-ink-4">
        {{ t('inbox.noSelectionHint') }}
      </p>
    </div>
  </section>
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
  border-left: 2px solid var(--lm-line-2);
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

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppI18n } from '../../i18n'
import { ApiError, apiBase, apiErrorMessage, mailbox, readErrorCode, token } from '../../state/session'
import { exportMailbox } from '../../state/inbox'
import { Plus, Trash2, X } from 'lucide-vue-next'

type FilterItem = {
  id: string
  name: string
  matchField: string
  matchOp: string
  matchValue: string
  action: string
  enabled: boolean
  createdAt: string
}

const { t } = useAppI18n()

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const filters = ref<FilterItem[]>([])
const filterField = ref<'sender' | 'subject' | 'body'>('sender')
const filterOp = ref<'contains' | 'equals'>('contains')
const filterValue = ref('')
const filterAction = ref<'delete' | 'star' | 'archive' | 'mark_read' | 'label'>('star')
const filterName = ref('')
const filterError = ref('')
const filterSaving = ref(false)

watch(() => props.open, (open) => {
  if (open) loadFilters()
})

async function loadFilters() {
  if (!mailbox.value) return
  const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/filters`, {
    headers: { authorization: `Bearer ${token.value}` },
  })
  if (!response.ok) return
  const payload = await response.json()
  filters.value = payload.filters ?? []
}

async function createFilter() {
  if (!mailbox.value) return
  filterError.value = ''
  if (!filterValue.value.trim()) {
    filterError.value = t('filters.valueRequired')
    return
  }
  filterSaving.value = true
  try {
    const response = await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/filters`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.value}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: filterName.value.trim(),
        matchField: filterField.value,
        matchOp: filterOp.value,
        matchValue: filterValue.value.trim(),
        action: filterAction.value,
        enabled: true,
      }),
    })
    if (!response.ok) throw new ApiError(await readErrorCode(response))
    filterValue.value = ''
    filterName.value = ''
    await loadFilters()
  } catch (err) {
    filterError.value = err instanceof ApiError ? apiErrorMessage(err.code, 'filters.createFailed') : t('filters.createFailed')
  } finally {
    filterSaving.value = false
  }
}

async function deleteFilter(filterId: string) {
  if (!mailbox.value) return
  await fetch(`${apiBase}/api/mailboxes/${mailbox.value.id}/filters/${filterId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token.value}` },
  })
  await loadFilters()
}
</script>

<template>
  <Transition name="lm-fade">
    <div v-if="open" class="fixed inset-0 z-[90] flex justify-end bg-ink/30" @click.self="emit('close')">
      <div class="lm-slide-panel flex h-full w-full max-w-md flex-col border-l border-line bg-canvas">
        <div class="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 class="text-lg font-semibold tracking-tight">{{ t('inbox.settings') }}</h2>
          <button class="grid size-8 place-items-center text-ink-3 transition hover:text-ink" type="button" :aria-label="t('inbox.close')" @click="emit('close')">
            <X :size="16" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </div>
        <div class="lm-scroll min-h-0 flex-1 space-y-10 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <section>
            <h3 class="lm-label mb-4">{{ t('inbox.exportJson') }} / mbox</h3>
            <div class="flex flex-wrap gap-2">
              <button class="border border-line-2 px-4 py-2 text-xs font-medium transition hover:border-ink" type="button" @click="exportMailbox('json')">{{ t('inbox.exportJson') }}</button>
              <button class="border border-line-2 px-4 py-2 text-xs font-medium transition hover:border-ink" type="button" @click="exportMailbox('mbox')">{{ t('inbox.exportMbox') }}</button>
            </div>
          </section>
          <section>
            <h3 class="lm-label mb-2">{{ t('filters.title') }}</h3>
            <p class="mb-4 text-xs leading-5 text-ink-4">{{ t('filters.hint') }}</p>
            <form class="grid gap-3" @submit.prevent="createFilter">
              <div class="grid grid-cols-2 gap-3">
                <select v-model="filterField" class="border-b border-line-2 bg-transparent py-2 text-sm outline-none focus:border-ink">
                  <option value="sender">{{ t('filters.fields.sender') }}</option>
                  <option value="subject">{{ t('filters.fields.subject') }}</option>
                  <option value="body">{{ t('filters.fields.body') }}</option>
                </select>
                <select v-model="filterOp" class="border-b border-line-2 bg-transparent py-2 text-sm outline-none focus:border-ink">
                  <option value="contains">{{ t('filters.ops.contains') }}</option>
                  <option value="equals">{{ t('filters.ops.equals') }}</option>
                </select>
              </div>
              <input v-model="filterValue" class="border-b border-line-2 bg-transparent py-2 text-sm outline-none placeholder:text-ink-5 focus:border-ink" :placeholder="t('filters.value')" />
              <select v-model="filterAction" class="border-b border-line-2 bg-transparent py-2 text-sm outline-none focus:border-ink">
                <option value="star">{{ t('filters.actions.star') }}</option>
                <option value="archive">{{ t('filters.actions.archive') }}</option>
                <option value="mark_read">{{ t('filters.actions.mark_read') }}</option>
                <option value="delete">{{ t('filters.actions.delete') }}</option>
                <option value="label">{{ t('filters.actions.label') }}</option>
              </select>
              <input v-model="filterName" class="border-b border-line-2 bg-transparent py-2 text-sm outline-none placeholder:text-ink-5 focus:border-ink" :placeholder="t('filters.namePlaceholder')" />
              <p v-if="filterError" class="text-xs text-danger">{{ filterError }}</p>
              <button class="inline-flex w-fit items-center gap-1.5 bg-ink px-4 py-2 text-sm font-medium text-canvas transition hover:bg-ink-2 disabled:opacity-60" type="submit" :disabled="filterSaving">
                <Plus :size="14" :stroke-width="2" aria-hidden="true" />
                {{ filterSaving ? t('filters.creating') : t('filters.create') }}
              </button>
            </form>
            <ul class="mt-6 border-t border-line">
              <li v-if="filters.length === 0" class="py-3 text-xs text-ink-5">{{ t('filters.empty') }}</li>
              <li v-for="f in filters" :key="f.id" class="group flex items-start justify-between gap-2 border-b border-line py-3 text-xs">
                <div class="min-w-0">
                  <p class="font-mono text-ink">{{ f.matchField }} {{ f.matchOp }} "{{ f.matchValue }}" → {{ f.action }}</p>
                  <p v-if="f.name" class="mt-0.5 text-ink-4">{{ f.name }}</p>
                </div>
                <button class="grid size-6 shrink-0 place-items-center text-ink-5 transition hover:text-danger" type="button" :aria-label="t('filters.remove')" @click="deleteFilter(f.id)">
                  <Trash2 :size="13" :stroke-width="1.75" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

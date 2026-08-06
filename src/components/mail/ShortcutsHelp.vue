<script setup lang="ts">
import { useAppI18n } from '../../i18n'
import { X } from 'lucide-vue-next'

const { t } = useAppI18n()

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Transition name="lm-fade">
    <div v-if="open" class="fixed inset-0 z-[90] flex items-center justify-center bg-ink/30 p-4" @click.self="emit('close')">
      <div class="w-full max-w-md border border-line bg-canvas p-6">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold tracking-tight">{{ t('keyboard.title') }}</h2>
          <button class="grid size-8 place-items-center text-ink-3 transition hover:text-ink" type="button" :aria-label="t('keyboard.close')" @click="emit('close')">
            <X :size="16" :stroke-width="1.75" aria-hidden="true" />
          </button>
        </div>
        <p class="mb-4 text-sm text-ink-4">{{ t('keyboard.hint') }}</p>
        <ul class="border-t border-line">
          <li v-for="(label, key) in {
            navigate: t('keyboard.navigate'),
            back: t('keyboard.back'),
            refresh: t('keyboard.refresh'),
            star: t('keyboard.star'),
            archive: t('keyboard.archive'),
            trash: t('keyboard.trash'),
            read: t('keyboard.read'),
            folder: t('keyboard.folder'),
            delete: t('keyboard.delete'),
            help: t('keyboard.help'),
            esc: t('keyboard.esc'),
          }" :key="key" class="flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-sm">
            <span class="min-w-0 text-ink-2">{{ label }}</span>
            <kbd class="shrink-0 border border-line-2 bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{{ key === 'folder' ? '1-5' : key.toUpperCase() }}</kbd>
          </li>
        </ul>
      </div>
    </div>
  </Transition>
</template>

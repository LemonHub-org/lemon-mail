<script setup lang="ts">
import { useAppI18n } from '../../i18n'

const { t } = useAppI18n()
</script>

<template>
  <footer class="px-5 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-8">
    <div class="mx-auto flex max-w-6xl flex-col gap-2 text-xs text-ink-4 sm:flex-row sm:items-center sm:justify-between">
      <span>{{ t('footer.copyright') }}</span>
      <span class="font-mono">{{ t('footer.service') }}</span>
    </div>
  </footer>
</template>

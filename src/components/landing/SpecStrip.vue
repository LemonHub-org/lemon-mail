<script setup lang="ts">
import { useAppI18n } from '../../i18n'

const { t } = useAppI18n()

const specs = [
  { key: 'password', index: '01' },
  { key: 'hosting', index: '02' },
  { key: 'recent', index: '03' },
  { key: 'domain', index: '04' },
] as const
</script>

<template>
  <section class="border-b border-line">
    <div class="mx-auto max-w-6xl px-5 md:px-8">
      <div class="grid grid-cols-2 md:grid-cols-4">
        <div
          v-for="spec in specs"
          :key="spec.key"
          class="border-l border-line px-4 py-6 first:border-l-0 first:pl-0 md:px-6 md:py-8 md:first:pl-0 [&:nth-child(3)]:border-l-0 [&:nth-child(3)]:pl-0 md:[&:nth-child(3)]:border-l md:[&:nth-child(3)]:px-6"
        >
          <p class="font-mono text-xs text-ink-5">{{ spec.index }}</p>
          <p class="mt-3 text-sm font-medium">{{ t(`trustBar.${spec.key}`) }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

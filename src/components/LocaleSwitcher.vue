<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { setLocale } from '../i18n'
import type { AppLocale } from '../i18n'

const { locale } = useI18n()

const options: { value: AppLocale; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en-US', label: 'EN' },
]

function switchLocale(next: AppLocale) {
  setLocale(next)
}
</script>

<template>
  <div class="flex items-baseline gap-2 text-xs font-medium" role="group" aria-label="语言 / Language">
    <button
      v-for="option in options"
      :key="option.value"
      class="transition"
      :class="locale === option.value ? 'text-ink underline underline-offset-4 decoration-accent decoration-2' : 'text-ink-4 hover:text-ink'"
      type="button"
      @click="switchLocale(option.value)"
    >{{ option.label }}</button>
  </div>
</template>

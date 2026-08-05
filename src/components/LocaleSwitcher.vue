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
  <div
    class="flex items-center gap-0.5 rounded-full border border-[#cfd5d1] p-0.5 text-xs font-medium"
    role="group"
    aria-label="语言 / Language"
  >
    <button
      v-for="option in options"
      :key="option.value"
      class="rounded-full px-2.5 py-1 transition"
      :class="locale === option.value ? 'bg-[#18201d] text-[#f7f8f6]' : 'text-[#59645f] hover:text-[#18201d]'"
      type="button"
      @click="switchLocale(option.value)"
    >{{ option.label }}</button>
  </div>
</template>

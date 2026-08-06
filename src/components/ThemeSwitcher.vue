<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentTheme, toggleTheme } from '../theme'

const { t } = useI18n()
const dark = computed(() => currentTheme.value === 'dark')

function onClick() {
  const el = document.documentElement
  el.classList.add('theme-transition')
  toggleTheme()
  setTimeout(() => el.classList.remove('theme-transition'), 350)
}
</script>

<template>
  <button
    class="grid size-8 place-items-center rounded-full border border-line-2 text-ink-3 transition hover:bg-chip hover:text-ink active:translate-y-px"
    type="button"
    :title="t('nav.theme')"
    :aria-label="t('nav.theme')"
    @click="onClick"
  >
    <svg v-if="dark" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke-linecap="round" />
    </svg>
    <svg v-else class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
</template>

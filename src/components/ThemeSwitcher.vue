<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Moon, Sun } from 'lucide-vue-next'
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
    class="grid size-8 place-items-center text-ink-3 transition hover:text-ink"
    type="button"
    :title="t('nav.theme')"
    :aria-label="t('nav.theme')"
    @click="onClick"
  >
    <Sun v-if="dark" :size="16" :stroke-width="1.75" aria-hidden="true" />
    <Moon v-else :size="16" :stroke-width="1.75" aria-hidden="true" />
  </button>
</template>

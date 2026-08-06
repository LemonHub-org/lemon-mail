<script setup lang="ts">
import { useAppI18n } from '../../i18n'
import { landingTab } from '../../state/landing'
import LemonMark from '../LemonMark.vue'
import LocaleSwitcher from '../LocaleSwitcher.vue'
import ThemeSwitcher from '../ThemeSwitcher.vue'
import { Download } from 'lucide-vue-next'

const { t } = useAppI18n()

defineProps<{ installVisible: boolean }>()
const emit = defineEmits<{ install: [] }>()
</script>

<template>
  <nav
    class="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur-md"
    :aria-label="t('nav.mainNav')"
  >
    <div class="mx-auto flex h-[calc(60px+env(safe-area-inset-top))] max-w-6xl items-center justify-between px-5 pt-[env(safe-area-inset-top)] md:px-8">
      <a href="#top" aria-label="Lemon Mail">
        <LemonMark :size="17" />
      </a>
      <div class="flex items-center gap-3 sm:gap-5">
        <LocaleSwitcher />
        <ThemeSwitcher />
        <button
          v-if="installVisible"
          class="hidden items-center gap-1.5 text-xs font-medium text-ink-3 underline-offset-4 transition hover:text-ink hover:underline sm:inline-flex"
          type="button"
          @click="emit('install')"
        >
          <Download :size="13" :stroke-width="1.75" aria-hidden="true" />
          {{ t('nav.install') }}
        </button>
        <a
          class="hidden text-sm font-medium text-ink-3 underline-offset-4 transition hover:text-ink hover:underline sm:inline"
          href="#access"
          @click="landingTab = 'login'"
        >{{ t('nav.login') }}</a>
        <a
          class="inline-flex items-center bg-ink px-4 py-2 text-sm font-medium text-canvas transition hover:bg-ink-2"
          href="#access"
          @click="landingTab = 'create'"
        >{{ t('nav.create') }}</a>
      </div>
    </div>
  </nav>
</template>

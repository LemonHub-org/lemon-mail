<script setup lang="ts">
import { useAppI18n } from '../../i18n'
import { landingTab } from '../../state/landing'
import LoginForm from './LoginForm.vue'
import CreateForm from './CreateForm.vue'
import RecentMailboxes from './RecentMailboxes.vue'

const { t } = useAppI18n()
</script>

<template>
  <section id="access" class="scroll-mt-20 border-b border-line">
    <div class="mx-auto grid max-w-6xl gap-14 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1fr_1fr] lg:gap-20">
      <div>
        <p class="lm-label mb-6 flex items-center gap-2.5">
          <span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
          {{ t('access.badge') }}
        </p>
        <h2 class="max-w-md text-4xl font-semibold leading-[1.12] tracking-[-0.035em] text-balance md:text-5xl">
          {{ t('access.heading1') }}<br />{{ t('access.heading2') }}
        </h2>
        <p class="mt-6 max-w-sm leading-7 text-ink-3">
          {{ t('access.description') }}
        </p>
        <RecentMailboxes />
      </div>

      <div class="lg:border-l lg:border-line lg:pl-20">
        <div class="mb-8 flex gap-6 border-b border-line" role="tablist">
          <button
            class="-mb-px border-b-2 pb-3 text-sm font-medium transition"
            :class="landingTab === 'login' ? 'border-ink text-ink' : 'border-transparent text-ink-4 hover:text-ink'"
            type="button"
            role="tab"
            :aria-selected="landingTab === 'login'"
            @click="landingTab = 'login'"
          >{{ t('tabs.login') }}</button>
          <button
            class="-mb-px border-b-2 pb-3 text-sm font-medium transition"
            :class="landingTab === 'create' ? 'border-ink text-ink' : 'border-transparent text-ink-4 hover:text-ink'"
            type="button"
            role="tab"
            :aria-selected="landingTab === 'create'"
            @click="landingTab = 'create'"
          >{{ t('tabs.create') }}</button>
        </div>
        <LoginForm v-if="landingTab === 'login'" />
        <CreateForm v-else />
      </div>
    </div>
  </section>
</template>

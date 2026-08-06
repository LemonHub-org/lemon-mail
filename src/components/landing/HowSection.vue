<script setup lang="ts">
import { useAppI18n } from '../../i18n'

const { t } = useAppI18n()

const steps = [
  { index: '01', key: 'naming' },
  { index: '02', key: 'hosting' },
  { index: '03', key: 'privacy' },
] as const
</script>

<template>
  <section id="how" class="scroll-mt-20 border-b border-line">
    <div class="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-[1fr_1.3fr] lg:gap-24">
      <div class="lg:sticky lg:top-28 lg:self-start">
        <p class="lm-label mb-6 flex items-center gap-2.5">
          <span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
          {{ t('how.sectionTitle') }}
        </p>
        <p class="max-w-sm leading-7 text-ink-3">{{ t('how.sectionTagline') }}</p>
      </div>

      <ol class="border-t border-line">
        <li
          v-for="step in steps"
          :key="step.key"
          class="group flex gap-6 border-b border-line py-8 lg:gap-10 lg:py-10"
        >
          <span class="pt-1 font-mono text-sm text-ink-5 transition-colors group-hover:text-accent-strong">{{ step.index }}</span>
          <div class="min-w-0">
            <h3 class="text-2xl font-semibold tracking-tight md:text-3xl">{{ t(`how.${step.key}.title`) }}</h3>
            <p class="mt-3 max-w-md leading-7 text-ink-3">{{ t(`how.${step.key}.body`) }}</p>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

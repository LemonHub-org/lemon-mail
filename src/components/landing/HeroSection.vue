<script setup lang="ts">
import { useAppI18n } from '../../i18n'
import { domain } from '../../state/session'
import { landingTab } from '../../state/landing'
import { ArrowRight } from 'lucide-vue-next'

const { t } = useAppI18n()
</script>

<template>
  <section id="top" class="border-b border-line">
    <div class="mx-auto max-w-6xl px-5 pb-14 pt-16 md:px-8 md:pb-20 md:pt-24">
      <p class="lm-rise lm-label mb-8 flex items-center gap-2.5">
        <span class="size-1.5 rounded-full bg-accent" aria-hidden="true"></span>
        {{ t('hero.kicker') }}
      </p>

      <h1
        class="lm-rise max-w-4xl text-[clamp(2.9rem,7.5vw,6rem)] font-semibold leading-[1.04] tracking-[-0.045em] text-balance"
        style="animation-delay: 70ms"
      >
        {{ t('hero.heading1') }}<br />
        <span class="bg-accent px-2 -mx-2 box-decoration-clone">{{ t('hero.heading2') }}</span>
      </h1>

      <div class="mt-10 flex flex-col gap-8 md:mt-14 md:flex-row md:items-end md:justify-between" style="animation-delay: 140ms">
        <p class="lm-rise max-w-md text-base leading-7 text-ink-3 md:text-lg md:leading-8">
          {{ t('hero.tagline') }}
        </p>
        <div class="lm-rise flex flex-wrap items-center gap-x-6 gap-y-3" style="animation-delay: 210ms">
          <a
            class="group inline-flex items-center gap-2 bg-accent px-6 py-3 font-medium text-accent-ink transition hover:bg-accent-hover"
            href="#access"
            @click="landingTab = 'create'"
          >
            {{ t('hero.create') }}
            <ArrowRight :size="16" :stroke-width="2" class="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
          <a
            class="inline-flex items-center gap-2 py-3 font-medium text-ink-2 underline decoration-line-2 underline-offset-8 transition hover:text-ink hover:decoration-ink"
            href="#access"
            @click="landingTab = 'login'"
          >{{ t('hero.login') }}</a>
        </div>
      </div>
    </div>

    <div class="overflow-hidden border-t border-line py-3" aria-hidden="true">
      <div class="lm-ticker flex w-max items-center gap-8 whitespace-nowrap font-mono text-xs tracking-[0.2em] text-ink-4 uppercase">
        <span v-for="n in 2" :key="n" class="flex items-center gap-8">
          <span v-for="i in 6" :key="i" class="flex items-center gap-8">
            <span>@{{ domain }}</span>
            <span class="size-1.5 bg-accent" aria-hidden="true"></span>
            <span>Lemon Mail</span>
            <span class="size-1.5 bg-accent" aria-hidden="true"></span>
          </span>
        </span>
      </div>
    </div>
  </section>
</template>

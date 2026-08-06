<script setup lang="ts">
import LandingNav from '../components/landing/LandingNav.vue'
import HeroSection from '../components/landing/HeroSection.vue'
import SpecStrip from '../components/landing/SpecStrip.vue'
import AccessSection from '../components/landing/AccessSection.vue'
import HowSection from '../components/landing/HowSection.vue'
import LandingFooter from '../components/landing/LandingFooter.vue'

defineProps<{ installVisible: boolean }>()
const emit = defineEmits<{ install: [] }>()
</script>

<template>
  <div class="min-h-dvh bg-canvas text-ink">
    <LandingNav :install-visible="installVisible" @install="emit('install')" />
    <HeroSection />
    <SpecStrip />
    <AccessSection />
    <HowSection />
    <LandingFooter />
  </div>
</template>

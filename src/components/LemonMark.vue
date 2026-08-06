<script setup lang="ts">
const props = withDefaults(defineProps<{ size?: number }>(), { size: 22 })
</script>

<template>
  <span class="inline-flex items-baseline gap-1.5 font-semibold tracking-tight" :style="{ fontSize: props.size + 'px' }">
    <span
      class="inline-block shrink-0 self-center rounded-full bg-accent"
      :style="{ width: props.size * 0.62 + 'px', height: props.size * 0.62 + 'px' }"
      aria-hidden="true"
    ></span>
    <span>Lemon&nbsp;Mail</span>
  </span>
</template>

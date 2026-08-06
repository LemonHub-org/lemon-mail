import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    transparent: {
      sizes: [64, 192, 512],
      favicon: 'favicon.svg',
      padding: 0.12,
    },
    maskable: {
      sizes: [512],
      padding: 0.15,
    },
    apple: {
      sizes: [180],
      padding: 0.12,
    },
  },
  images: ['public/favicon.svg'],
})

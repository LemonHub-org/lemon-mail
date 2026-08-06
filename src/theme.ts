import { ref } from 'vue'

export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'lm-theme'

export const currentTheme = ref<Theme>('light')

export function resolveTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme, persist = true): void {
  currentTheme.value = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      /* ignore */
    }
  }
}

export function initTheme(): void {
  applyTheme(resolveTheme(), false)
}

export function toggleTheme(): Theme {
  const next: Theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
  applyTheme(next)
  return next
}

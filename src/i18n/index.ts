import { createI18n, useI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

export type MessageSchema = typeof zhCN

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema {}
}

type NestedKey<T> = T extends Record<string, unknown>
  ? { [K in keyof T]: `${K & string}` | `${K & string}.${NestedKey<T[K]>}` }[keyof T]
  : never

export type MessageKey = NestedKey<MessageSchema>

export function useAppI18n() {
  const { t, te, locale } = useI18n()
  return {
    t: <K extends MessageKey>(key: K, named?: Record<string, string | number>) => t(key as never, named as never),
    te: (key: string) => te(key as never),
    locale,
  }
}

export type AppLocale = 'zh-CN' | 'en-US'

const LOCALE_STORAGE_KEY = 'lm-locale'

function resolveInitialLocale(): AppLocale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved === 'zh-CN' || saved === 'en-US') return saved
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveInitialLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})

export function setLocale(next: AppLocale): void {
  i18n.global.locale.value = next
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    /* ignore */
  }
}

export function gt<K extends MessageKey>(key: K, named?: Record<string, string | number>): string {
  return i18n.global.t(key as never, named as never) as string
}

export function gte(key: string): boolean {
  return i18n.global.te(key as never)
}

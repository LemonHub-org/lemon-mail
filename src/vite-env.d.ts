/// <reference types="vite/client" />

interface Turnstile {
  render: (element: HTMLElement, options: { sitekey: string; action?: string }) => string
  getResponse: (widgetId?: string) => string
  reset: (widgetId?: string) => void
}

interface Window {
  turnstile?: Turnstile
}

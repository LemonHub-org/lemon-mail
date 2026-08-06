import { nextTick, onMounted, ref } from 'vue'
import { TURNSTILE_SITEKEY } from './session'

export function useTurnstile(action: string) {
  const el = ref<HTMLElement | null>(null)
  let widgetId = ''
  let rendered = false

  function render() {
    nextTick(() => {
      if (!el.value || !window.turnstile || rendered) return
      widgetId = window.turnstile.render(el.value, { sitekey: TURNSTILE_SITEKEY, action })
      rendered = true
    })
  }

  function token(): string {
    return window.turnstile?.getResponse(widgetId) ?? ''
  }

  function reset() {
    if (!widgetId || !window.turnstile) return
    try {
      window.turnstile.reset(widgetId)
    } catch {
      return
    }
  }

  onMounted(render)

  return { el, token, reset }
}

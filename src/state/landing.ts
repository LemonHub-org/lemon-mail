import { ref } from 'vue'
import { enterInbox } from './inbox'
import { mailbox, savedToken, token, type Mailbox } from './session'

export type LandingTab = 'login' | 'create'

export const landingTab = ref<LandingTab>('login')
export const loginLocalPart = ref('')

export function pickRecent(item: Mailbox) {
  loginLocalPart.value = item.localPart
  landingTab.value = 'login'
  const saved = savedToken(item.id)
  if (saved) {
    token.value = saved
    mailbox.value = item
    enterInbox()
  }
}

<script setup lang="ts">
import { ref } from 'vue'
import { useAppI18n } from '../../i18n'
import { ApiError, apiErrorMessage, applySession, domain, requestLogin } from '../../state/session'
import { loginLocalPart } from '../../state/landing'
import { enterInbox } from '../../state/inbox'
import { useTurnstile } from '../../state/turnstile'
import { Eye, EyeOff } from 'lucide-vue-next'

const { t } = useAppI18n()

const password = ref('')
const error = ref('')
const submitting = ref(false)
const showPassword = ref(false)
const turnstile = useTurnstile('turnstile-spin-v2')

async function submit() {
  error.value = ''
  if (!loginLocalPart.value.trim() || !password.value) {
    error.value = t('loginForm.fillAll')
    return
  }
  submitting.value = true
  try {
    const turnstileToken = turnstile.token()
    if (!turnstileToken) {
      error.value = t('loginForm.turnstileRequired')
      return
    }
    const result = await requestLogin(loginLocalPart.value.trim(), password.value, turnstileToken)
    applySession(result.mailbox, result.token)
    password.value = ''
    await enterInbox()
  } catch (err) {
    error.value = err instanceof ApiError ? apiErrorMessage(err.code, 'loginForm.failed') : t('loginForm.failed')
    turnstile.reset()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="grid gap-6" @submit.prevent="submit">
    <div>
      <label class="lm-label mb-2.5 block" for="login-local">{{ t('loginForm.emailLabel') }}</label>
      <div class="flex border-b border-line-2 transition focus-within:border-ink">
        <input
          id="login-local"
          v-model="loginLocalPart"
          class="min-w-0 flex-1 bg-transparent py-3 font-mono text-[15px] outline-none placeholder:text-ink-5"
          :placeholder="t('loginForm.emailPlaceholder')"
          autocomplete="username"
          spellcheck="false"
        />
        <span class="flex items-center pl-3 font-mono text-[15px] text-ink-4">@{{ domain }}</span>
      </div>
    </div>
    <div>
      <label class="lm-label mb-2.5 block" for="login-password">{{ t('loginForm.passwordLabel') }}</label>
      <div class="relative border-b border-line-2 transition focus-within:border-ink">
        <input
          id="login-password"
          v-model="password"
          class="w-full bg-transparent py-3 pr-10 text-base outline-none placeholder:text-ink-5 sm:text-sm"
          :type="showPassword ? 'text' : 'password'"
          :placeholder="t('loginForm.passwordPlaceholder')"
          autocomplete="current-password"
        />
        <button
          class="absolute inset-y-0 right-0 my-auto grid size-8 place-items-center text-ink-4 transition hover:text-ink"
          type="button"
          :aria-label="showPassword ? t('loginForm.hide') : t('loginForm.show')"
          @click="showPassword = !showPassword"
        >
          <EyeOff v-if="showPassword" :size="15" :stroke-width="1.75" aria-hidden="true" />
          <Eye v-else :size="15" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </div>
    </div>
    <p v-if="error" class="border-l-2 border-danger bg-error-bg px-4 py-3 text-sm text-danger" role="alert">{{ error }}</p>
    <div class="cf-turnstile" data-action="turnstile-spin-v2" :ref="turnstile.el"></div>
    <button
      class="w-full bg-ink px-5 py-3.5 font-medium text-canvas transition hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
      :disabled="submitting"
    >{{ submitting ? t('loginForm.submitting') : t('loginForm.submit') }}</button>
  </form>
</template>

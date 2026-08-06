<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppI18n } from '../../i18n'
import {
  ApiError,
  apiErrorMessage,
  applySession,
  domain,
  inviteRequired,
  requestCreateMailbox,
  validateLocalPartClient,
} from '../../state/session'
import { enterInbox } from '../../state/inbox'
import { useTurnstile } from '../../state/turnstile'
import { Eye, EyeOff, Info } from 'lucide-vue-next'

const { t } = useAppI18n()

const localPart = ref('')
const password = ref('')
const inviteCode = ref('')
const error = ref('')
const flash = ref('')
const submitting = ref(false)
const showPassword = ref(false)
const turnstile = useTurnstile('turnstile-spin-v2')

const addressPreview = computed(() => `${localPart.value.trim() || 'hello'}@${domain}`)

async function submit() {
  error.value = ''
  flash.value = ''
  if (!localPart.value.trim() || !password.value.trim()) {
    error.value = t('createForm.fillAll')
    return
  }
  const prefixError = validateLocalPartClient(localPart.value)
  if (prefixError) {
    error.value = prefixError
    return
  }
  if (password.value.length < 8) {
    error.value = t('createForm.passwordShort')
    return
  }
  if (inviteRequired.value && !inviteCode.value.trim()) {
    error.value = t('createForm.inviteRequired')
    return
  }
  submitting.value = true
  try {
    const turnstileToken = turnstile.token()
    if (!turnstileToken) {
      error.value = t('createForm.turnstileRequired')
      return
    }
    const result = await requestCreateMailbox({
      localPart: localPart.value,
      password: password.value,
      turnstileToken,
      ...(inviteCode.value.trim() ? { inviteCode: inviteCode.value.trim() } : {}),
    })
    applySession(result.mailbox, result.token)
    localPart.value = ''
    password.value = ''
    inviteCode.value = ''
    flash.value = t('createForm.created', { address: `${result.mailbox.localPart}@${domain}` })
    await enterInbox()
  } catch (err) {
    error.value = err instanceof ApiError ? apiErrorMessage(err.code, 'createForm.failed') : t('createForm.failed')
    turnstile.reset()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="grid gap-6" @submit.prevent="submit">
    <div>
      <label class="lm-label mb-2.5 block" for="create-local">{{ t('createForm.localLabel') }}</label>
      <div class="flex border-b border-line-2 transition focus-within:border-ink">
        <input
          id="create-local"
          v-model="localPart"
          class="min-w-0 flex-1 bg-transparent py-3 font-mono text-[15px] outline-none placeholder:text-ink-5"
          :placeholder="t('createForm.localPlaceholder')"
          autocomplete="off"
          spellcheck="false"
        />
        <span class="flex items-center pl-3 font-mono text-[15px] text-ink-4">@{{ domain }}</span>
      </div>
      <p class="mt-2 text-xs text-ink-4">{{ t('createForm.localHint', { address: addressPreview }) }}</p>
    </div>
    <div>
      <label class="lm-label mb-2.5 block" for="create-password">{{ t('createForm.passwordLabel') }}</label>
      <div class="relative border-b border-line-2 transition focus-within:border-ink">
        <input
          id="create-password"
          v-model="password"
          class="w-full bg-transparent py-3 pr-10 text-base outline-none placeholder:text-ink-5 sm:text-sm"
          :type="showPassword ? 'text' : 'password'"
          :placeholder="t('createForm.passwordPlaceholder')"
          autocomplete="new-password"
        />
        <button
          class="absolute inset-y-0 right-0 my-auto grid size-8 place-items-center text-ink-4 transition hover:text-ink"
          type="button"
          :aria-label="showPassword ? t('createForm.hide') : t('createForm.show')"
          @click="showPassword = !showPassword"
        >
          <EyeOff v-if="showPassword" :size="15" :stroke-width="1.75" aria-hidden="true" />
          <Eye v-else :size="15" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </div>
      <p class="mt-2 text-xs text-ink-4">{{ t('createForm.passwordHint') }}</p>
      <p class="mt-3 flex items-start gap-1.5 text-xs leading-5 text-ink-3">
        <Info :size="13" :stroke-width="1.75" class="mt-0.5 shrink-0" aria-hidden="true" />
        {{ t('createForm.onePerUser') }}
      </p>
    </div>
    <div v-if="inviteRequired">
      <label class="lm-label mb-2.5 block" for="create-invite">{{ t('createForm.inviteLabel') }}</label>
      <input
        id="create-invite"
        v-model="inviteCode"
        class="w-full border-b border-line-2 bg-transparent py-3 text-base outline-none transition placeholder:text-ink-5 focus:border-ink sm:text-sm"
        type="text"
        :placeholder="t('createForm.invitePlaceholder')"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <p v-if="error" class="border-l-2 border-danger bg-error-bg px-4 py-3 text-sm text-danger" role="alert">{{ error }}</p>
    <p v-if="flash" class="border-l-2 border-success bg-success-bg px-4 py-3 text-sm text-success" role="status">{{ flash }}</p>
    <div class="cf-turnstile" data-action="turnstile-spin-v2" :ref="turnstile.el"></div>
    <button
      class="w-full bg-ink px-5 py-3.5 font-medium text-canvas transition hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
      :disabled="submitting"
    >{{ submitting ? t('createForm.submitting') : t('createForm.submit') }}</button>
  </form>
</template>

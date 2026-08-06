<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  backToList,
  deleteEmail,
  folder,
  loadInbox,
  patchEmail,
  refreshInbox,
  searchActive,
  searchQuery,
  selectAdjacent,
  selected,
  selectedId,
  sidebarOpen,
  switchFolder,
  toggleRead,
  type Folder,
} from '../state/inbox'
import MailHeader from '../components/mail/MailHeader.vue'
import FolderSidebar from '../components/mail/FolderSidebar.vue'
import MailList from '../components/mail/MailList.vue'
import ReadingPane from '../components/mail/ReadingPane.vue'
import SettingsDrawer from '../components/mail/SettingsDrawer.vue'
import ShortcutsHelp from '../components/mail/ShortcutsHelp.vue'

const settingsOpen = ref(false)
const helpOpen = ref(false)

let searchDebounce: ReturnType<typeof setTimeout> | null = null

watch(folder, () => {
  searchQuery.value = ''
  searchActive.value = ''
})

watch(searchQuery, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(async () => {
    searchActive.value = searchQuery.value.trim()
    selected.value = null
    selectedId.value = null
    await loadInbox(true)
  }, 350)
})

function folderKey(key: string): Folder | undefined {
  const map: Record<string, Folder> = { '1': 'inbox', '2': 'unread', '3': 'starred', '4': 'archive', '5': 'trash' }
  return map[key]
}

function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return
  if (e.key === '?') {
    e.preventDefault()
    helpOpen.value = true
    return
  }
  if (e.key === 'Escape') {
    if (helpOpen.value) {
      helpOpen.value = false
      return
    }
    if (selected.value && window.matchMedia('(max-width: 767px)').matches) {
      backToList()
    } else if (sidebarOpen.value) {
      sidebarOpen.value = false
    }
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && (e.metaKey || e.ctrlKey)) {
    if (selectedId.value) {
      e.preventDefault()
      deleteEmail(selectedId.value)
    }
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault()
    selectAdjacent(1)
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault()
    selectAdjacent(-1)
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault()
    refreshInbox()
  } else if (e.key === 'u') {
    e.preventDefault()
    if (selected.value) backToList()
  } else if (selectedId.value) {
    if (e.key === 'a') {
      e.preventDefault()
      patchEmail(selectedId.value, { folder: selected.value?.folder === 'archive' ? 'inbox' : 'archive' })
    } else if (e.key === 's') {
      e.preventDefault()
      patchEmail(selectedId.value, { isStarred: !selected.value?.isStarred })
    } else if (e.key === 'm') {
      e.preventDefault()
      patchEmail(selectedId.value, { folder: selected.value?.folder === 'trash' ? 'inbox' : 'trash' })
    } else if (e.key === 'x') {
      e.preventDefault()
      toggleRead(selectedId.value)
    } else if (folderKey(e.key)) {
      e.preventDefault()
      switchFolder(folderKey(e.key)!)
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
    <MailHeader @open-settings="settingsOpen = true" />

    <div class="relative flex min-h-0 flex-1">
      <Transition name="lm-fade">
        <div
          v-if="sidebarOpen"
          class="absolute inset-0 z-40 bg-ink/30 md:hidden"
          @click="sidebarOpen = false"
        ></div>
      </Transition>

      <FolderSidebar />
      <MailList />
      <ReadingPane />
    </div>

    <SettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
    <ShortcutsHelp :open="helpOpen" @close="helpOpen = false" />
  </div>
</template>

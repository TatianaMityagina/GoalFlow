<script setup lang="ts">
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import type { Toast } from '@/types'

function runAction(toast: Toast): void {
  toast.action?.()
  store.dismissToast(toast.id)
}
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="toast in store.toasts.value" :key="toast.id" class="toast" :class="`toast--${toast.kind}`">
      <span class="toast__message">{{ toast.message }}</span>
      <button v-if="toast.actionLabel" class="btn btn--default btn--sm" @click="runAction(toast)">
        {{ toast.actionLabel }}
      </button>
      <button class="btn btn--ghost btn--sm btn--icon" aria-label="Закрыть" @click="store.dismissToast(toast.id)">
        <Icon name="close" :size="13" />
      </button>
    </div>
  </div>
</template>

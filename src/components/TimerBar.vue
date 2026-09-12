<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import { formatMinutes, formatStopwatch, formatTime } from '@/lib/utils'

const task = computed(() => store.runningTask.value)
const forgotten = computed(() => store.forgottenTimer.value)

// Порог из настроек используется как правдоподобная длительность сессии.
function keepThreshold(): void {
  store.trimRunningTimer(store.db.settings.idleThresholdMinutes)
}
</script>

<template>
  <div>
    <div v-if="store.showForgottenPrompt.value && forgotten !== null" class="forgotten" role="alert">
      <Icon name="alert" :size="16" />
      <span class="forgotten__text">
        Таймер на задаче <strong>{{ task?.title }}</strong> идёт уже
        {{ formatMinutes(forgotten.minutes) }}, с {{ formatTime(forgotten.entry.startedAt) }}. Всё ещё работаете?
      </span>
      <button class="btn btn--default btn--sm" @click="store.dismissForgottenPrompt()">Да, продолжаю</button>
      <button class="btn btn--default btn--sm" @click="keepThreshold">
        Записать {{ formatMinutes(store.db.settings.idleThresholdMinutes) }}
      </button>
      <button class="btn btn--ghost btn--sm" @click="store.trimRunningTimer(0)">Отбросить</button>
    </div>

    <div v-if="task !== null" class="timerbar">
      <span class="timerbar__pulse" />
      <button class="timerbar__task" style="text-align: left" @click="store.openTaskId.value = task.id">
        <span class="timerbar__title">{{ task.title }}</span>
        <span class="timerbar__sub">
          начат в {{ formatTime(store.runningEntry.value?.startedAt ?? '') }} ·
          всего {{ formatMinutes(store.spentMinutes(task.id)) }}
        </span>
      </button>
      <span class="timerbar__clock">{{ formatStopwatch(store.runningSeconds.value) }}</span>
      <button class="btn btn--default btn--sm" @click="store.stopTimer()">
        <Icon name="stop" :size="12" filled />
        <span class="hide-sm">Стоп</span>
      </button>
    </div>
  </div>
</template>

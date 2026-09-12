<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import TaskMeta from './TaskMeta.vue'
import { store } from '@/stores/store'
import type { ID, Task, TaskStatus } from '@/types'
import { formatMinutes, formatStopwatch } from '@/lib/utils'

const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'todo', label: 'Сделать' },
  { status: 'doing', label: 'В работе' },
  { status: 'done', label: 'Готово' }
]

const columns = computed(() =>
  COLUMNS.map((column) => ({
    ...column,
    tasks: store.visibleTasks.value.filter((task) => task.status === column.status)
  }))
)

const dragId = ref<ID | null>(null)
const overColumn = ref<TaskStatus | null>(null)

function onDragStart(event: DragEvent, task: Task): void {
  dragId.value = task.id
  event.dataTransfer?.setData('text/plain', task.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDrop(status: TaskStatus): void {
  if (dragId.value !== null) store.updateTask(dragId.value, { status })
  dragId.value = null
  overColumn.value = null
}

function columnMinutes(tasks: Task[]): number {
  return tasks.reduce((sum, task) => sum + store.spentMinutes(task.id), 0)
}

function spentLabel(task: Task): string {
  if (store.runningEntry.value?.taskId === task.id) return formatStopwatch(store.runningSeconds.value)
  const minutes = store.spentMinutes(task.id)
  return minutes === 0 ? '' : formatMinutes(minutes)
}
</script>

<template>
  <div class="board">
    <section
      v-for="column in columns"
      :key="column.status"
      class="column"
      :class="{ 'column--over': overColumn === column.status }"
      :aria-label="column.label"
      @dragover.prevent="overColumn = column.status"
      @dragleave="overColumn = null"
      @drop.prevent="onDrop(column.status)"
    >
      <header class="column__head">
        <span class="status-dot" :class="`status-dot--${column.status}`" />
        <span>{{ column.label }}</span>
        <span class="spacer" />
        <span class="faint">{{ column.tasks.length }}</span>
        <span v-if="columnMinutes(column.tasks) > 0" class="badge">
          {{ formatMinutes(columnMinutes(column.tasks)) }}
        </span>
      </header>

      <div class="column__body">
        <button
          v-for="task in column.tasks"
          :key="task.id"
          class="card"
          :class="{
            'card--selected': store.openTaskId.value === task.id,
            'card--running': store.runningEntry.value?.taskId === task.id,
            'card--dragging': dragId === task.id
          }"
          draggable="true"
          @click="store.openTaskId.value = task.id"
          @dragstart="onDragStart($event, task)"
          @dragend="
            dragId = null;
            overColumn = null
          "
        >
          <span class="card__title">{{ task.title }}</span>
          <TaskMeta :task="task" compact />
          <div class="card__meta">
            <span
              v-if="spentLabel(task) !== ''"
              class="badge"
              :class="{ 'badge--success': store.runningEntry.value?.taskId === task.id }"
            >
              <Icon name="clock" :size="10" />
              {{ spentLabel(task) }}
            </span>
            <span class="spacer" />
            <span
              class="btn btn--ghost btn--sm btn--icon"
              role="button"
              tabindex="0"
              :aria-label="store.runningEntry.value?.taskId === task.id ? 'Остановить таймер' : 'Запустить таймер'"
              @click.stop="store.toggleTimer(task.id)"
              @keydown.enter.stop="store.toggleTimer(task.id)"
            >
              <Icon
                :name="store.runningEntry.value?.taskId === task.id ? 'stop' : 'play'"
                :size="12"
                filled
              />
            </span>
          </div>
        </button>

        <p v-if="column.tasks.length === 0" class="text-xs faint" style="padding: var(--space-3); text-align: center">
          Перетащите задачу сюда
        </p>
      </div>
    </section>
  </div>
</template>

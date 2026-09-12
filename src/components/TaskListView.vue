<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import TaskMeta from './TaskMeta.vue'
import { store } from '@/stores/store'
import type { ID, Task } from '@/types'
import { daysUntil, formatMinutes, formatStopwatch } from '@/lib/utils'

interface Group {
  key: string
  label: string
  tasks: Task[]
}

// Группировка по срочности, а не по проектам: иерархия показана в сайдбаре.
const groups = computed<Group[]>(() => {
  const buckets = new Map<string, Task[]>([
    ['overdue', []],
    ['today', []],
    ['soon', []],
    ['later', []],
    ['someday', []],
    ['done', []]
  ])

  for (const task of store.visibleTasks.value) {
    if (task.status === 'done') {
      buckets.get('done')?.push(task)
      continue
    }
    if (task.dueDate === null) {
      buckets.get('someday')?.push(task)
      continue
    }
    const diff = daysUntil(task.dueDate)
    const key = diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 7 ? 'soon' : 'later'
    buckets.get(key)?.push(task)
  }

  const labels: Record<string, string> = {
    overdue: 'Просрочено',
    today: 'Сегодня',
    soon: 'Ближайшие 7 дней',
    later: 'Позже',
    someday: 'Без срока',
    done: 'Завершённые'
  }

  return [...buckets.entries()]
    .filter(([, tasks]) => tasks.length > 0)
    .map(([key, tasks]) => ({ key, label: labels[key] ?? key, tasks }))
})

const dragId = ref<ID | null>(null)
const dropId = ref<ID | null>(null)

function onDragStart(event: DragEvent, task: Task): void {
  dragId.value = task.id
  event.dataTransfer?.setData('text/plain', task.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(event: DragEvent, task: Task): void {
  if (dragId.value === null || dragId.value === task.id) return
  event.preventDefault()
  dropId.value = task.id
}

function onDrop(task: Task): void {
  if (dragId.value !== null && dragId.value !== task.id) store.reorderTask(dragId.value, task.id)
  dragId.value = null
  dropId.value = null
}

function spentLabel(task: Task): string {
  if (store.runningEntry.value?.taskId === task.id) return formatStopwatch(store.runningSeconds.value)
  const minutes = store.spentMinutes(task.id)
  return minutes === 0 ? '—' : formatMinutes(minutes)
}

function isOverEstimate(task: Task): boolean {
  return task.estimateMinutes !== null && store.spentMinutes(task.id) > task.estimateMinutes
}
</script>

<template>
  <div v-if="groups.length === 0" class="empty">
    <div class="empty__icon"><Icon name="check" :size="20" /></div>
    <h2 class="empty__title">Ничего не найдено</h2>
    <p class="empty__text">
      Под условие <code class="mono">{{ store.effectiveQuery.value || 'текущего вида' }}</code> не
      подходит ни одна задача. Сбросьте фильтр или нажмите <span class="kbd">N</span>, чтобы добавить.
    </p>
    <div class="empty__actions">
      <button class="btn btn--default" @click="store.clearFilters()">Сбросить фильтры</button>
    </div>
  </div>

  <div v-else class="stack">
    <div v-for="group in groups" :key="group.key" class="tasklist">
      <div class="tasklist__group">
        <span>{{ group.label }}</span>
        <span class="spacer" />
        <span class="faint">{{ group.tasks.length }}</span>
      </div>

      <div
        v-for="task in group.tasks"
        :key="task.id"
        class="task"
        :class="{
          'task--done': task.status === 'done',
          'task--selected': store.openTaskId.value === task.id,
          'task--running': store.runningEntry.value?.taskId === task.id,
          'task--dragging': dragId === task.id,
          'task--drop-target': dropId === task.id
        }"
        draggable="true"
        role="button"
        tabindex="0"
        :aria-label="task.title"
        @click="store.openTaskId.value = task.id"
        @keydown.enter="store.openTaskId.value = task.id"
        @dragstart="onDragStart($event, task)"
        @dragover="onDragOver($event, task)"
        @dragleave="dropId = null"
        @drop.prevent="onDrop(task)"
        @dragend="
          dragId = null;
          dropId = null
        "
      >
        <input
          class="checkbox task__check"
          type="checkbox"
          :checked="task.status === 'done'"
          :aria-label="`Отметить «${task.title}» выполненной`"
          @click.stop
          @change="store.toggleTaskDone(task.id)"
        />

        <div class="task__body">
          <span class="task__title">{{ task.title }}</span>
          <TaskMeta :task="task" />
        </div>

        <div class="task__side">
          <span
            class="task__time"
            :class="{
              'task__time--running': store.runningEntry.value?.taskId === task.id,
              'task__time--over': isOverEstimate(task)
            }"
            :title="
              task.estimateMinutes === null
                ? 'Учтённое время'
                : `Учтено при оценке ${formatMinutes(task.estimateMinutes)}`
            "
          >
            {{ spentLabel(task) }}
          </span>
          <button
            class="btn btn--ghost btn--sm btn--icon task__play"
            :class="{ 'task__play--on': store.runningEntry.value?.taskId === task.id }"
            :aria-label="store.runningEntry.value?.taskId === task.id ? 'Остановить таймер' : 'Запустить таймер'"
            @click.stop="store.toggleTimer(task.id)"
          >
            <Icon
              :name="store.runningEntry.value?.taskId === task.id ? 'stop' : 'play'"
              :size="13"
              filled
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

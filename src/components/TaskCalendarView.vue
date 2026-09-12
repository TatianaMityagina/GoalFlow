<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import type { ID, ISODate, Task } from '@/types'
import { addDays, startOfWeek, todayISO, toISODate } from '@/lib/utils'

/** Первый день отображаемого месяца. */
const cursor = ref<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

const monthLabel = computed<string>(() =>
  cursor.value.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
)

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

interface Cell {
  day: ISODate
  inMonth: boolean
  isToday: boolean
  tasks: Task[]
}

const byDay = computed<Map<ISODate, Task[]>>(() => {
  const map = new Map<ISODate, Task[]>()
  for (const task of store.visibleTasks.value) {
    if (task.dueDate === null) continue
    const list = map.get(task.dueDate) ?? []
    list.push(task)
    map.set(task.dueDate, list)
  }
  return map
})

// Всегда 42 ячейки: высота сетки не меняется между месяцами.
const cells = computed<Cell[]>(() => {
  const first = startOfWeek(cursor.value)
  const month = cursor.value.getMonth()
  const today = todayISO()
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(first, index)
    const day = toISODate(date)
    return {
      day,
      inMonth: date.getMonth() === month,
      isToday: day === today,
      tasks: byDay.value.get(day) ?? []
    }
  })
})

const unscheduled = computed<Task[]>(() =>
  store.visibleTasks.value.filter((task) => task.dueDate === null && task.status !== 'done')
)

function shiftMonth(delta: number): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1)
}

function goToday(): void {
  cursor.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
}

const dragId = ref<ID | null>(null)
const overDay = ref<ISODate | null>(null)

function onDragStart(event: DragEvent, taskId: ID): void {
  dragId.value = taskId
  event.dataTransfer?.setData('text/plain', taskId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

/** Перетаскивание на день задаёт срок. */
function onDrop(day: ISODate): void {
  if (dragId.value !== null) store.updateTask(dragId.value, { dueDate: day })
  dragId.value = null
  overDay.value = null
}

function clearDueDate(): void {
  if (dragId.value !== null) store.updateTask(dragId.value, { dueDate: null })
  dragId.value = null
  overDay.value = null
}
</script>

<template>
  <div class="calendar">
    <header class="calendar__head">
      <h2 class="calendar__month">{{ monthLabel }}</h2>
      <button class="btn btn--ghost btn--sm" @click="goToday">Сегодня</button>
      <button class="btn btn--default btn--sm btn--icon" aria-label="Предыдущий месяц" @click="shiftMonth(-1)">
        <Icon name="chevronLeft" :size="14" />
      </button>
      <button class="btn btn--default btn--sm btn--icon" aria-label="Следующий месяц" @click="shiftMonth(1)">
        <Icon name="chevronRight" :size="14" />
      </button>
    </header>

    <div class="calendar__weekdays">
      <div v-for="weekday in WEEKDAYS" :key="weekday" class="calendar__weekday">{{ weekday }}</div>
    </div>

    <div class="calendar__grid">
      <div
        v-for="cell in cells"
        :key="cell.day"
        class="day"
        :class="{
          'day--outside': !cell.inMonth,
          'day--today': cell.isToday,
          'day--over': overDay === cell.day
        }"
        @dragover.prevent="overDay = cell.day"
        @dragleave="overDay = null"
        @drop.prevent="onDrop(cell.day)"
      >
        <span class="day__num">{{ Number(cell.day.slice(8)) }}</span>
        <button
          v-for="task in cell.tasks.slice(0, 3)"
          :key="task.id"
          class="day__task"
          :class="[`day__task--${task.priority}`, { 'day__task--done': task.status === 'done' }]"
          :title="task.title"
          draggable="true"
          @click="store.openTaskId.value = task.id"
          @dragstart="onDragStart($event, task.id)"
          @dragend="dragId = null"
        >
          {{ task.title }}
        </button>
        <span v-if="cell.tasks.length > 3" class="day__more">ещё {{ cell.tasks.length - 3 }}</span>
      </div>
    </div>

    <div
      v-if="unscheduled.length > 0"
      class="calendar__unscheduled"
      @dragover.prevent
      @drop.prevent="clearDueDate"
    >
      <span class="text-xs faint nowrap">Без срока — перетащите на день:</span>
      <button
        v-for="task in unscheduled.slice(0, 12)"
        :key="task.id"
        class="chip"
        draggable="true"
        @click="store.openTaskId.value = task.id"
        @dragstart="onDragStart($event, task.id)"
        @dragend="dragId = null"
      >
        {{ task.title }}
      </button>
      <span v-if="unscheduled.length > 12" class="text-xs faint">+{{ unscheduled.length - 12 }}</span>
    </div>
  </div>
</template>

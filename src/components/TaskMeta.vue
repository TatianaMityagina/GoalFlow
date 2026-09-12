<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import type { Priority, Task } from '@/types'
import { daysUntil, formatDueDate } from '@/lib/utils'

const props = withDefaults(defineProps<{ task: Task; compact?: boolean }>(), { compact: false })

/** Проект или, при его отсутствии, цель задачи. */
const contextLabel = computed<{ text: string; color: string } | null>(() => {
  const project = store.projectById(props.task.projectIds[0] ?? null)
  if (project !== null) return { text: project.title, color: project.color }
  const goal = store.goalById(props.task.goalIds[0] ?? null)
  if (goal !== null) return { text: goal.title, color: goal.color }
  return null
})

const extraContexts = computed<number>(
  () => Math.max(0, props.task.projectIds.length + props.task.goalIds.length - 1)
)

const PRIORITY_LABELS: Record<Priority, string> = {
  none: '',
  low: 'низкий',
  medium: 'средний',
  high: 'высокий'
}

const dueKind = computed<'danger' | 'warning' | 'plain'>(() => {
  if (props.task.dueDate === null || props.task.status === 'done') return 'plain'
  const diff = daysUntil(props.task.dueDate)
  if (diff < 0) return 'danger'
  if (diff === 0) return 'warning'
  return 'plain'
})
</script>

<template>
  <div class="task__meta">
    <span v-if="props.task.priority !== 'none'" class="row" style="gap: 4px">
      <span class="prio-dot" :class="`prio-dot--${props.task.priority}`" />
      <span v-if="!props.compact">{{ PRIORITY_LABELS[props.task.priority] }}</span>
    </span>

    <span v-if="contextLabel !== null" class="badge">
      <span class="badge__dot" :style="{ background: contextLabel.color }" />
      {{ contextLabel.text }}
    </span>
    <span v-if="extraContexts > 0" class="badge" :title="'Связана более чем с одним проектом или целью'">
      +{{ extraContexts }}
    </span>

    <span
      v-if="props.task.dueDate !== null"
      class="badge"
      :class="{
        'badge--danger': dueKind === 'danger',
        'badge--warning': dueKind === 'warning'
      }"
    >
      <Icon name="calendar" :size="10" />
      {{ formatDueDate(props.task.dueDate) }}
    </span>

    <span v-for="tag in props.task.tags.slice(0, props.compact ? 2 : 4)" :key="tag" class="badge badge--tag">
      {{ tag }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import { parseCapture } from '@/lib/capture'
import { claudeReady, suggestLocally, suggestWithClaude, type Suggestion } from '@/lib/ai'
import { formatDueDate, formatMinutes } from '@/lib/utils'
import type { Priority } from '@/types'

const PRIORITY_LABELS: Record<Priority, string> = {
  none: '',
  low: 'низкий',
  medium: 'средний',
  high: 'высокий'
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const text = ref<string>('')
const inputRef = ref<HTMLInputElement | null>(null)
const suggestion = ref<Suggestion | null>(null)
const aiBusy = ref<boolean>(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    text.value = ''
    suggestion.value = null
    void nextTick(() => inputRef.value?.focus())
  }
)

const parsed = computed(() => parseCapture(text.value, store.db.projects, store.db.goals))

/** Проект, в который попадёт задача при текущем вводе. */
const targetProject = computed(() => store.projectById(parsed.value.projectId))

function submit(keepOpen: boolean): void {
  const capture = parsed.value
  if (capture.title === '') return

  let projectId = capture.projectId
  // Токен `@` без совпадений создаёт проект, а не теряется.
  if (projectId === null && capture.newProjectName !== null) {
    const goalIds = store.selectedGoalId.value === null ? [] : [store.selectedGoalId.value]
    projectId = store.createProject(capture.newProjectName, goalIds).id
    store.pushToast(`Проект «${capture.newProjectName}» создан`, 'success')
  }

  // Приоритет источников: токен, выбор в сайдбаре, предложение AI.
  const scopedProject = store.selectedProjectId.value
  const finalProjectId = projectId ?? scopedProject ?? suggestion.value?.projectId ?? null
  const goalId = capture.goalId ?? (finalProjectId === null ? store.selectedGoalId.value : null)

  const task = store.createTask({
    title: capture.title,
    projectIds: finalProjectId === null ? [] : [finalProjectId],
    goalIds: goalId === null ? [] : [goalId],
    tags: capture.tags.length > 0 ? capture.tags : suggestion.value?.tags ?? [],
    priority: capture.priority !== 'none' ? capture.priority : suggestion.value?.priority ?? 'none',
    dueDate: capture.dueDate,
    estimateMinutes: capture.estimateMinutes ?? suggestion.value?.estimateMinutes ?? null
  })

  store.pushToast(`Добавлено: «${task.title}»`, 'success', {
    label: 'Открыть',
    run: () => {
      store.openTaskId.value = task.id
    }
  })

  text.value = ''
  suggestion.value = null
  if (!keepOpen) emit('close')
  else void nextTick(() => inputRef.value?.focus())
}

async function askForSuggestion(): Promise<void> {
  const title = parsed.value.title
  if (title === '') return
  aiBusy.value = true
  const context = { goals: store.db.goals, projects: store.db.projects, tasks: store.db.tasks }
  try {
    suggestion.value = claudeReady(store.db.settings)
      ? await suggestWithClaude(title, context, store.db.settings)
      : suggestLocally(title, context)
  } catch (error) {
  // Сбой вызова модели не блокирует ввод.
    suggestion.value = suggestLocally(title, context)
    store.pushToast(
      error instanceof Error ? `Claude недоступен: ${error.message}` : 'Claude недоступен',
      'warning'
    )
  } finally {
    aiBusy.value = false
  }
}

function applySuggestion(): void {
  const current = suggestion.value
  if (current === null) return
  const additions: string[] = []
  const project = store.projectById(current.projectId)
  if (project !== null && parsed.value.projectId === null) {
    additions.push(`@${project.title.split(' ')[0] ?? project.title}`)
  }
  current.tags.forEach((tag) => {
    if (!parsed.value.tags.includes(tag)) additions.push(`#${tag}`)
  })
  if (current.priority !== 'none' && parsed.value.priority === 'none') additions.push(`!${current.priority}`)
  if (current.estimateMinutes !== null && parsed.value.estimateMinutes === null) {
    additions.push(`~${current.estimateMinutes}m`)
  }
  text.value = `${text.value.trim()} ${additions.join(' ')}`.trim()
  // Объект сохраняется: id проекта нужен, если токен `@` неточный.
  void nextTick(() => inputRef.value?.focus())
}
</script>

<template>
  <div v-if="props.open" class="overlay" @click.self="emit('close')">
    <div class="modal modal--palette" role="dialog" aria-modal="true" aria-label="Быстрый ввод">
      <div class="palette__search">
        <Icon name="plus" :size="17" />
        <input
          ref="inputRef"
          v-model="text"
          class="palette__input"
          placeholder="Написать текст для первого экрана @лендинг #текст !высокий ~90м ^завтра"
          aria-label="Новая задача"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter.exact.prevent="submit(false)"
          @keydown.enter.shift.prevent="submit(true)"
          @keydown.esc="emit('close')"
        />
      </div>

      <div class="modal__body" style="gap: var(--space-3)">
        <div v-if="parsed.title !== ''" class="row row--wrap">
          <span class="text-xs faint nowrap">Будет сохранено как:</span>
          <span class="badge badge--accent">{{ parsed.title }}</span>
          <span v-if="targetProject !== null" class="badge">
            <span class="badge__dot" :style="{ background: targetProject.color }" />
            {{ targetProject.title }}
          </span>
          <span v-else-if="parsed.newProjectName !== null" class="badge badge--warning">
            новый проект: {{ parsed.newProjectName }}
          </span>
          <span v-if="parsed.priority !== 'none'" class="badge">
            <span class="prio-dot" :class="`prio-dot--${parsed.priority}`" />
            {{ PRIORITY_LABELS[parsed.priority] }}
          </span>
          <span v-if="parsed.dueDate !== null" class="badge">{{ formatDueDate(parsed.dueDate) }}</span>
          <span v-if="parsed.estimateMinutes !== null" class="badge">
            ~{{ formatMinutes(parsed.estimateMinutes) }}
          </span>
          <span v-for="tag in parsed.tags" :key="tag" class="badge badge--tag">{{ tag }}</span>
        </div>

        <p class="field__hint">
          <span class="mono">@проект</span> · <span class="mono">+цель</span> ·
          <span class="mono">#тег</span> · <span class="mono">!высокий</span> ·
          <span class="mono">~90м</span> · <span class="mono">^завтра</span>
        </p>

        <div v-if="suggestion !== null" class="insight">
          <div class="row">
            <Icon name="sparkles" :size="13" />
            <span class="insight__title">
              Подсказка ({{ suggestion.source === 'claude' ? 'Claude' : 'офлайн' }})
            </span>
            <span class="spacer" />
            <button class="btn btn--default btn--sm" @click="applySuggestion">Применить</button>
            <button class="btn btn--ghost btn--sm" @click="suggestion = null">Пропустить</button>
          </div>
          <p class="insight__detail">{{ suggestion.rationale }}</p>
        </div>
      </div>

      <div class="modal__foot">
        <button
          class="btn btn--ghost btn--sm"
          :disabled="aiBusy || parsed.title === ''"
          title="Предложить проект, теги и оценку"
          @click="askForSuggestion"
        >
          <Icon name="sparkles" :size="13" :class="aiBusy ? 'spin' : ''" />
          Подсказать
        </button>
        <span class="modal__foot-spacer" />
        <span class="text-xs faint nowrap" style="align-self: center">
          <span class="kbd">⇧↵</span> добавить и продолжить
        </span>
        <button class="btn btn--primary btn--sm" :disabled="parsed.title === ''" @click="submit(false)">
          Добавить
        </button>
      </div>
    </div>
  </div>
</template>

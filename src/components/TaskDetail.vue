<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import type { ID, Priority, Task, TaskStatus } from '@/types'
import {
  formatDateTime,
  formatDurationToken,
  formatMinutes,
  formatStopwatch,
  formatTime,
  todayISO
} from '@/lib/utils'
import { parseDuration } from '@/lib/query'
import { claudeReady, decomposeLocally, decomposeWithClaude } from '@/lib/ai'

const task = computed<Task | null>(() => store.taskById(store.openTaskId.value))

function close(): void {
  store.openTaskId.value = null
}

/* ------------------------------- поля ------------------------------ */

const titleDraft = ref<string>('')
const noteDraft = ref<string>('')
const tagDraft = ref<string>('')
const estimateDraft = ref<string>('')

// Черновики перезаполняются при открытии другой задачи.
watch(
  task,
  (current, previous) => {
    if (current === null || current.id === previous?.id) return
    titleDraft.value = current.title
    noteDraft.value = current.note
    estimateDraft.value =
      current.estimateMinutes === null ? '' : formatDurationToken(current.estimateMinutes)
    tagDraft.value = ''
    steps.value = []
    aiError.value = ''
  },
  { immediate: true }
)

function commitTitle(): void {
  if (task.value === null) return
  const trimmed = titleDraft.value.trim()
  if (trimmed === '' || trimmed === task.value.title) {
    titleDraft.value = task.value.title
    return
  }
  store.updateTask(task.value.id, { title: trimmed })
}

function commitNote(): void {
  if (task.value === null || noteDraft.value === task.value.note) return
  store.updateTask(task.value.id, { note: noteDraft.value })
}

function commitEstimate(): void {
  if (task.value === null) return
  const raw = estimateDraft.value.trim()
  if (raw === '') {
    store.updateTask(task.value.id, { estimateMinutes: null })
    return
  }
  // Принимает «90», «1ч30м», «2ч».
  const minutes = parseDuration(raw)
  if (minutes === null || minutes <= 0) {
    estimateDraft.value =
      task.value.estimateMinutes === null ? '' : formatDurationToken(task.value.estimateMinutes)
    return
  }
  store.updateTask(task.value.id, { estimateMinutes: minutes })
  estimateDraft.value = formatDurationToken(minutes)
}

function addTag(): void {
  if (task.value === null) return
  const tag = tagDraft.value.trim().toLowerCase().replace(/^#/, '')
  if (tag === '') return
  store.updateTask(task.value.id, { tags: [...task.value.tags, tag] })
  tagDraft.value = ''
}

function removeTag(tag: string): void {
  if (task.value === null) return
  store.updateTask(task.value.id, { tags: task.value.tags.filter((candidate) => candidate !== tag) })
}

function toggleProject(projectId: ID): void {
  if (task.value === null) return
  const current = task.value.projectIds
  store.updateTask(task.value.id, {
    projectIds: current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId]
  })
}

function toggleGoal(goalId: ID): void {
  if (task.value === null) return
  const current = task.value.goalIds
  store.updateTask(task.value.id, {
    goalIds: current.includes(goalId) ? current.filter((id) => id !== goalId) : [...current, goalId]
  })
}

const STATUSES: Array<{ id: TaskStatus; label: string }> = [
  { id: 'todo', label: 'Сделать' },
  { id: 'doing', label: 'В работе' },
  { id: 'done', label: 'Готово' }
]

const PRIORITIES: Array<{ id: Priority; label: string }> = [
  { id: 'none', label: 'Без приоритета' },
  { id: 'low', label: 'Низкий' },
  { id: 'medium', label: 'Средний' },
  { id: 'high', label: 'Высокий' }
]

/* ------------------------------- время ------------------------------ */

const entries = computed(() => (task.value === null ? [] : store.entriesOfTask(task.value.id)))
const spent = computed<number>(() => (task.value === null ? 0 : store.spentMinutes(task.value.id)))
const isRunning = computed<boolean>(() => store.runningEntry.value?.taskId === task.value?.id)

const manualAmount = ref<string>('')
const manualDay = ref<string>(todayISO())
const manualNote = ref<string>('')

function addManual(): void {
  if (task.value === null) return
  const minutes = parseDuration(manualAmount.value)
  if (minutes === null || minutes <= 0) {
    store.pushToast('Введите длительность: 45м, 1ч30м или 90', 'warning')
    return
  }
  store.addManualEntry(task.value.id, minutes, manualNote.value, manualDay.value)
  manualAmount.value = ''
  manualNote.value = ''
  store.pushToast(`Записано ${formatMinutes(minutes)}`, 'success')
}

function entryMinutes(startedAt: string, endedAt: string | null): number {
  const end = endedAt === null ? store.now.value : Date.parse(endedAt)
  return Math.round(Math.max(0, (end - Date.parse(startedAt)) / 60_000))
}

const overrun = computed<number | null>(() => {
  if (task.value === null || task.value.estimateMinutes === null) return null
  const difference = spent.value - task.value.estimateMinutes
  return difference > 0 ? difference : null
})

/* --------------------------------- AI -------------------------------- */

const steps = ref<string[]>([])
const aiBusy = ref<boolean>(false)
const aiError = ref<string>('')
const aiSource = ref<'local' | 'claude'>('local')

async function decompose(): Promise<void> {
  if (task.value === null) return
  aiBusy.value = true
  aiError.value = ''
  const current = task.value
  try {
    if (claudeReady(store.db.settings)) {
      steps.value = await decomposeWithClaude(current.title, current.note, store.db.settings)
      aiSource.value = 'claude'
    } else {
      steps.value = decomposeLocally(current.title)
      aiSource.value = 'local'
    }
  } catch (error) {
    // При сбое вызова модели используется офлайн-разбиение.
    aiError.value = error instanceof Error ? error.message : 'Не удалось обратиться к Claude.'
    steps.value = decomposeLocally(current.title)
    aiSource.value = 'local'
  } finally {
    aiBusy.value = false
  }
}

/** Создаёт задачу из предложенного шага, наследуя контекст текущей. */
function acceptStep(step: string): void {
  if (task.value === null) return
  store.createTask({
    title: step,
    projectIds: [...task.value.projectIds],
    goalIds: [...task.value.goalIds],
    tags: [...task.value.tags],
    priority: task.value.priority,
    dueDate: task.value.dueDate
  })
  steps.value = steps.value.filter((candidate) => candidate !== step)
  store.pushToast('Подзадача добавлена', 'success')
}

function acceptAllSteps(): void {
  ;[...steps.value].forEach(acceptStep)
}

function removeTask(): void {
  if (task.value === null) return
  store.deleteTask(task.value.id)
}
</script>

<template>
  <div v-if="task !== null" class="overlay" @click.self="close">
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Карточка задачи">
      <header class="modal__head">
        <span class="status-dot" :class="`status-dot--${task.status}`" />
        <span class="modal__title truncate">Задача</span>
        <button
          class="btn btn--ghost btn--sm btn--icon"
          :aria-label="isRunning ? 'Остановить таймер' : 'Запустить таймер'"
          @click="store.toggleTimer(task.id)"
        >
          <Icon :name="isRunning ? 'stop' : 'play'" :size="14" filled />
        </button>
        <button class="btn btn--ghost btn--sm btn--icon" aria-label="Закрыть" @click="close">
          <Icon name="close" :size="15" />
        </button>
      </header>

      <div class="modal__body">
        <div class="field">
          <textarea
            v-model="titleDraft"
            class="textarea"
            rows="2"
            style="font-size: var(--text-lg); font-weight: 600; min-height: 0"
            aria-label="Название задачи"
            @blur="commitTitle"
            @keydown.enter.prevent="commitTitle"
          />
        </div>

        <div class="row row--wrap">
          <div class="segmented">
            <button
              v-for="status in STATUSES"
              :key="status.id"
              class="segmented__btn"
              :class="{ 'segmented__btn--active': task.status === status.id }"
              @click="store.updateTask(task.id, { status: status.id })"
            >
              {{ status.label }}
            </button>
          </div>

          <select
            class="select"
            style="width: auto; min-width: 110px"
            aria-label="Приоритет"
            :value="task.priority"
            @change="
              store.updateTask(task.id, {
                priority: ($event.target as HTMLSelectElement).value as Priority
              })
            "
          >
            <option v-for="priority in PRIORITIES" :key="priority.id" :value="priority.id">
              {{ priority.label }}
            </option>
          </select>
        </div>

        <div class="row row--wrap" style="align-items: flex-end">
          <div class="field" style="flex: 1 1 150px">
            <label class="field__label" for="task-due">Срок</label>
            <input
              id="task-due"
              class="input"
              type="date"
              :value="task.dueDate ?? ''"
              @change="
                store.updateTask(task.id, {
                  dueDate: ($event.target as HTMLInputElement).value || null
                })
              "
            />
          </div>
          <div class="field" style="flex: 1 1 130px">
            <label class="field__label" for="task-estimate">Оценка</label>
            <input
              id="task-estimate"
              v-model="estimateDraft"
              class="input"
              placeholder="1ч30м"
              @blur="commitEstimate"
              @keydown.enter="commitEstimate"
            />
          </div>
        </div>

        <div class="field">
          <label class="field__label" for="task-note">Заметки</label>
          <textarea
            id="task-note"
            v-model="noteDraft"
            class="textarea"
            placeholder="Всё, что стоит помнить об этой задаче"
            @blur="commitNote"
          />
        </div>

        <div class="field">
          <span class="field__label">Теги</span>
          <div class="tagline">
            <button v-for="tag in task.tags" :key="tag" class="badge badge--tag" @click="removeTag(tag)">
              {{ tag }}
              <Icon name="close" :size="9" />
            </button>
            <input
              v-model="tagDraft"
              class="input"
              style="width: 130px; min-height: 22px; height: 22px; padding: 0 6px; font-size: var(--text-2xs)"
              list="known-tags"
              placeholder="добавить тег"
              @keydown.enter.prevent="addTag"
              @blur="addTag"
            />
            <datalist id="known-tags">
              <option v-for="tag in store.allTags.value" :key="tag" :value="tag" />
            </datalist>
          </div>
        </div>

        <div class="field">
          <span class="field__label">Проекты</span>
          <p v-if="store.db.projects.length === 0" class="field__hint">
            Проектов пока нет — задача прекрасно живёт и без проекта.
          </p>
          <div class="tagline">
            <button
              v-for="project in store.db.projects"
              :key="project.id"
              class="chip"
              :class="{ 'chip--active': task.projectIds.includes(project.id) }"
              @click="toggleProject(project.id)"
            >
              {{ project.title }}
            </button>
          </div>
        </div>

        <div class="field">
          <span class="field__label">Цели (прямая связь)</span>
          <p class="field__hint">
            Задача уже наследует цели своих проектов. Указывайте цель здесь, только если хотите
            привязать задачу к ней напрямую.
          </p>
          <div class="tagline">
            <button
              v-for="goal in store.db.goals"
              :key="goal.id"
              class="chip"
              :class="{ 'chip--active': task.goalIds.includes(goal.id) }"
              @click="toggleGoal(goal.id)"
            >
              {{ goal.title }}
            </button>
          </div>
        </div>

        <hr class="divider" />

        <section class="stack stack--sm">
          <div class="row">
            <span class="field__label">Время</span>
            <span class="spacer" />
            <span class="text-sm mono" :style="{ color: isRunning ? 'var(--running)' : 'inherit' }">
              {{ isRunning ? formatStopwatch(store.runningSeconds.value) : formatMinutes(spent) }}
              <template v-if="task.estimateMinutes !== null">
                / {{ formatMinutes(task.estimateMinutes) }}
              </template>
            </span>
          </div>

          <div v-if="task.estimateMinutes !== null" class="progress">
            <div
              class="progress__fill"
              :style="{
                width: `${Math.min(100, (spent / Math.max(1, task.estimateMinutes)) * 100)}%`,
                background: overrun === null ? 'var(--accent)' : 'var(--warning)'
              }"
            />
          </div>
          <p v-if="overrun !== null" class="field__hint" style="color: var(--warning)">
            Превышение оценки на {{ formatMinutes(overrun) }} — может, стоит разбить задачу?
          </p>

          <div class="row row--wrap" style="align-items: flex-end">
            <div class="field" style="flex: 0 1 108px">
              <label class="field__label" for="manual-amount">Сколько</label>
              <input
                id="manual-amount"
                v-model="manualAmount"
                class="input"
                placeholder="45м"
                @keydown.enter="addManual"
              />
            </div>
            <div class="field" style="flex: 1 1 130px">
              <label class="field__label" for="manual-day">Дата</label>
              <input id="manual-day" v-model="manualDay" class="input" type="date" />
            </div>
            <button class="btn btn--default" @click="addManual">Добавить</button>
          </div>
          <input
            v-model="manualNote"
            class="input"
            placeholder="Чем занимались? (необязательно)"
            @keydown.enter="addManual"
          />

          <div v-if="entries.length > 0" class="stack stack--sm" style="margin-top: var(--space-2)">
            <div v-for="entry in entries" :key="entry.id" class="entry">
              <Icon :name="entry.source === 'timer' ? 'clock' : 'edit'" :size="12" />
              <span class="mono nowrap">{{ formatMinutes(entryMinutes(entry.startedAt, entry.endedAt)) }}</span>
              <span class="faint truncate">
                {{ formatDateTime(entry.startedAt) }}
                <template v-if="entry.endedAt !== null">– {{ formatTime(entry.endedAt) }}</template>
                <template v-else> · идёт</template>
                <template v-if="entry.note !== ''"> · {{ entry.note }}</template>
              </span>
              <span class="spacer" />
              <button
                class="btn btn--ghost btn--sm btn--icon"
                aria-label="Удалить эту запись времени"
                @click="store.deleteTimeEntry(entry.id)"
              >
                <Icon name="trash" :size="12" />
              </button>
            </div>
          </div>
        </section>

        <hr class="divider" />

        <section class="stack stack--sm">
          <div class="row">
            <span class="field__label">Разбить на шаги</span>
            <span class="spacer" />
            <button class="btn btn--default btn--sm" :disabled="aiBusy" @click="decompose">
              <Icon name="sparkles" :size="13" :class="aiBusy ? 'spin' : ''" />
              {{ aiBusy ? 'Думаю…' : 'Предложить подзадачи' }}
            </button>
          </div>
          <p class="field__hint">
            {{
              claudeReady(store.db.settings)
                ? 'Работает через Claude с вашим ключом. Ничего не сохраняется, пока вы не примете шаг.'
                : 'Офлайн-подсказки по формулировке задачи. Включите AI в настройках, чтобы были точнее.'
            }}
          </p>
          <p v-if="aiError !== ''" class="field__hint" style="color: var(--warning)">
            Claude недоступен ({{ aiError }}) — показаны офлайн-подсказки.
          </p>

          <div v-if="steps.length > 0" class="stack stack--sm">
            <div v-for="step in steps" :key="step" class="entry">
              <span class="truncate">{{ step }}</span>
              <span class="spacer" />
              <button class="btn btn--ghost btn--sm" @click="acceptStep(step)">Добавить</button>
              <button
                class="btn btn--ghost btn--sm btn--icon"
                aria-label="Убрать подсказку"
                @click="steps = steps.filter((s) => s !== step)"
              >
                <Icon name="close" :size="12" />
              </button>
            </div>
            <div class="row">
              <span class="text-xs faint">{{ aiSource === 'claude' ? 'От Claude' : 'Офлайн-подсказка' }}</span>
              <span class="spacer" />
              <button class="btn btn--primary btn--sm" @click="acceptAllSteps">Добавить все</button>
            </div>
          </div>
        </section>
      </div>

      <footer class="modal__foot">
        <button class="btn btn--danger btn--sm" @click="removeTask">
          <Icon name="trash" :size="13" />
          Удалить
        </button>
        <span class="modal__foot-spacer" />
        <span class="text-xs faint nowrap" style="align-self: center">
          Создана {{ formatDateTime(task.createdAt) }}
        </span>
      </footer>
    </aside>
  </div>
</template>

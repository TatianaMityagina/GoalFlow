<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import type { ID } from '@/types'

// Один диалог обслуживает цель и проект в режимах создания и редактирования:
// набор полей различается двумя пунктами, дублировать компонент незачем.
const props = defineProps<{
  open: boolean
  kind: 'goal' | 'project'
  presetGoalId: ID | null
  editId: ID | null
}>()
const emit = defineEmits<{ (event: 'close'): void }>()

const title = ref<string>('')
const note = ref<string>('')
const targetDate = ref<string>('')
const goalIds = ref<ID[]>([])
const confirmingDelete = ref<boolean>(false)
const inputRef = ref<HTMLInputElement | null>(null)

const isEdit = computed<boolean>(() => props.editId !== null)

const heading = computed<string>(() => {
  if (props.kind === 'goal') return isEdit.value ? 'Цель' : 'Новая цель'
  return isEdit.value ? 'Проект' : 'Новый проект'
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    confirmingDelete.value = false

    const goal = props.kind === 'goal' ? store.goalById(props.editId) : null
    const project = props.kind === 'project' ? store.projectById(props.editId) : null

    title.value = goal?.title ?? project?.title ?? ''
    note.value = goal?.note ?? project?.note ?? ''
    targetDate.value = goal?.targetDate ?? ''
    goalIds.value = project?.goalIds
      ? [...project.goalIds]
      : props.presetGoalId === null
        ? []
        : [props.presetGoalId]

    void nextTick(() => inputRef.value?.focus())
  }
)

function toggleGoal(id: ID): void {
  goalIds.value = goalIds.value.includes(id)
    ? goalIds.value.filter((candidate) => candidate !== id)
    : [...goalIds.value, id]
}

function submit(): void {
  if (title.value.trim() === '') return

  if (props.kind === 'goal') {
    if (props.editId !== null) {
      store.updateGoal(props.editId, {
        title: title.value.trim(),
        note: note.value,
        targetDate: targetDate.value === '' ? null : targetDate.value
      })
      store.pushToast('Цель сохранена', 'success')
    } else {
      const goal = store.createGoal(title.value, note.value)
      if (targetDate.value !== '') store.updateGoal(goal.id, { targetDate: targetDate.value })
      store.selectedGoalId.value = goal.id
      store.pushToast(`Цель «${goal.title}» создана`, 'success')
    }
  } else if (props.editId !== null) {
    store.updateProject(props.editId, {
      title: title.value.trim(),
      note: note.value,
      goalIds: [...goalIds.value]
    })
    store.pushToast('Проект сохранён', 'success')
  } else {
    const project = store.createProject(title.value, goalIds.value, note.value)
    store.selectedProjectId.value = project.id
    store.pushToast(`Проект «${project.title}» создан`, 'success')
  }

  emit('close')
}

function remove(): void {
  if (props.editId === null) return
  if (props.kind === 'goal') store.deleteGoal(props.editId)
  else store.deleteProject(props.editId)
  emit('close')
}
</script>

<template>
  <div v-if="props.open" class="overlay" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="heading">
      <header class="modal__head">
        <Icon :name="props.kind === 'goal' ? 'target' : 'folder'" :size="16" />
        <h2 class="modal__title">{{ heading }}</h2>
        <button class="btn btn--ghost btn--sm btn--icon" aria-label="Закрыть" @click="emit('close')">
          <Icon name="close" :size="15" />
        </button>
      </header>

      <div class="modal__body">
        <div class="field">
          <label class="field__label" for="entity-title">Название</label>
          <input
            id="entity-title"
            ref="inputRef"
            v-model="title"
            class="input"
            :placeholder="props.kind === 'goal' ? 'Запустить продукт до марта' : 'MVP лендинга'"
            @keydown.enter="submit"
            @keydown.esc="emit('close')"
          />
          <p v-if="props.kind === 'goal' && !isEdit" class="field__hint">
            Цель — это ответ на вопрос «зачем». К ней крепятся проекты и задачи, а её прогресс —
            это прогресс всего, что под ней.
          </p>
        </div>

        <div class="field">
          <label class="field__label" for="entity-note">Заметки</label>
          <textarea id="entity-note" v-model="note" class="textarea" rows="3" />
        </div>

        <div v-if="props.kind === 'goal'" class="field">
          <label class="field__label" for="entity-date">Целевая дата</label>
          <input id="entity-date" v-model="targetDate" class="input" type="date" />
        </div>

        <div v-else-if="store.db.goals.length > 0" class="field">
          <span class="field__label">Каким целям служит?</span>
          <div class="tagline">
            <button
              v-for="goal in store.db.goals"
              :key="goal.id"
              class="chip"
              :class="{ 'chip--active': goalIds.includes(goal.id) }"
              @click="toggleGoal(goal.id)"
            >
              {{ goal.title }}
            </button>
          </div>
          <p class="field__hint">Необязательно; проект может служить нескольким целям.</p>
        </div>

        <template v-if="isEdit">
          <hr class="divider" />
          <div class="row row--wrap">
            <button v-if="!confirmingDelete" class="btn btn--ghost btn--sm" @click="confirmingDelete = true">
              <Icon name="trash" :size="13" />
              {{ props.kind === 'goal' ? 'Удалить цель' : 'Удалить проект' }}
            </button>
            <template v-else>
              <span class="text-xs">
                {{
                  props.kind === 'goal'
                    ? 'Удалить цель? Проекты и задачи останутся, но потеряют связь с ней.'
                    : 'Удалить проект? Задачи останутся, но потеряют связь с ним.'
                }}
              </span>
              <button class="btn btn--danger btn--sm" @click="remove">Удалить</button>
              <button class="btn btn--ghost btn--sm" @click="confirmingDelete = false">Отмена</button>
            </template>
          </div>
        </template>
      </div>

      <footer class="modal__foot">
        <span class="modal__foot-spacer" />
        <button class="btn btn--ghost btn--sm" @click="emit('close')">Отмена</button>
        <button class="btn btn--primary btn--sm" :disabled="title.trim() === ''" @click="submit">
          {{ isEdit ? 'Сохранить' : 'Создать' }}
        </button>
      </footer>
    </div>
  </div>
</template>

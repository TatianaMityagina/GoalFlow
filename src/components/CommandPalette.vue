<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon, { type IconName } from './Icon.vue'
import { store } from '@/stores/store'
import { subsequenceMatch } from '@/lib/utils'
import type { ViewMode } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (event: 'close'): void
  (
    event: 'action',
    name:
      | 'quick-capture'
      | 'new-goal'
      | 'new-project'
      | 'settings'
      | 'stats'
      | 'export-json'
      | 'export-csv'
      | 'import'
      | 'sample'
  ): void
  (event: 'edit-goal', goalId: string): void
  (event: 'edit-project', projectId: string): void
}>()

interface Command {
  id: string
  group: string
  label: string
  hint?: string
  icon: IconName
  run: () => void
}

const query = ref<string>('')
const active = ref<number>(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    query.value = ''
    active.value = 0
    void nextTick(() => inputRef.value?.focus())
  }
)

function done(run: () => void): () => void {
  return () => {
    run()
    emit('close')
  }
}

const commands = computed<Command[]>(() => {
  const list: Command[] = [
    {
      id: 'capture',
      group: 'Создать',
      label: 'Новая задача',
      hint: 'N',
      icon: 'plus',
      run: done(() => emit('action', 'quick-capture'))
    },
    {
      id: 'goal',
      group: 'Создать',
      label: 'Новая цель',
      hint: 'G',
      icon: 'target',
      run: done(() => emit('action', 'new-goal'))
    },
    {
      id: 'project',
      group: 'Создать',
      label: 'Новый проект',
      hint: 'P',
      icon: 'folder',
      run: done(() => emit('action', 'new-project'))
    }
  ]

  const modes: Array<{ mode: ViewMode; label: string; icon: IconName; key: string }> = [
    { mode: 'list', label: 'Перейти к списку', icon: 'list', key: '1' },
    { mode: 'board', label: 'Перейти к доске', icon: 'board', key: '2' },
    { mode: 'calendar', label: 'Перейти к календарю', icon: 'calendar', key: '3' }
  ]
  modes.forEach((item) => {
    list.push({
      id: `mode-${item.mode}`,
      group: 'Вид',
      label: item.label,
      hint: item.key,
      icon: item.icon,
      run: done(() => {
        store.viewMode.value = item.mode
      })
    })
  })

  list.push({
    id: 'stats',
    group: 'Вид',
    label: 'Время и наблюдения',
    icon: 'chart',
    run: done(() => emit('action', 'stats'))
  })
  list.push({
    id: 'completed',
    group: 'Вид',
    label: store.showCompleted.value ? 'Скрыть завершённые' : 'Показать завершённые',
    icon: 'check',
    run: done(() => {
      store.showCompleted.value = !store.showCompleted.value
    })
  })
  list.push({
    id: 'clear',
    group: 'Вид',
    label: 'Сбросить все фильтры',
    icon: 'close',
    run: done(() => store.clearFilters())
  })

  store.db.savedViews.forEach((view) => {
    list.push({
      id: `view-${view.id}`,
      group: 'Сохранённые виды',
      label: view.name,
      hint: view.query,
      icon: 'filter',
      run: done(() => store.applyView(view))
    })
  })

  // Переход к цели или проекту с клавиатуры.
  store.db.goals.forEach((goal) => {
    list.push({
      id: `goal-${goal.id}`,
      group: 'Перейти к цели',
      label: goal.title,
      icon: 'target',
      run: done(() => {
        store.clearFilters()
        store.selectedGoalId.value = goal.id
      })
    })
    list.push({
      id: `goal-edit-${goal.id}`,
      group: 'Изменить цель',
      label: goal.title,
      icon: 'edit',
      run: done(() => emit('edit-goal', goal.id))
    })
  })
  store.db.projects.forEach((project) => {
    list.push({
      id: `project-${project.id}`,
      group: 'Перейти к проекту',
      label: project.title,
      icon: 'folder',
      run: done(() => {
        store.clearFilters()
        store.selectedProjectId.value = project.id
      })
    })
    list.push({
      id: `project-edit-${project.id}`,
      group: 'Изменить проект',
      label: project.title,
      icon: 'edit',
      run: done(() => emit('edit-project', project.id))
    })
  })

  const running = store.runningTask.value
  if (running !== null) {
    list.push({
      id: 'stop-timer',
      group: 'Таймер',
      label: `Остановить таймер на «${running.title}»`,
      hint: 'T',
      icon: 'stop',
      run: done(() => store.stopTimer())
    })
  }

  // Незакрытые задачи доступны для открытия и запуска таймера.
  store.db.tasks
    .filter((task) => task.status !== 'done')
    .slice(0, 200)
    .forEach((task) => {
      list.push({
        id: `task-${task.id}`,
        group: 'Задачи',
        label: task.title,
        hint: 'открыть',
        icon: 'list',
        run: done(() => {
          store.openTaskId.value = task.id
        })
      })
      list.push({
        id: `track-${task.id}`,
        group: 'Запустить таймер',
        label: task.title,
        icon: 'play',
        run: done(() => store.startTimer(task.id))
      })
    })

  list.push(
    {
      id: 'export-json',
      group: 'Данные',
      label: 'Выгрузить бэкап (JSON)',
      hint: 'E',
      icon: 'download',
      run: done(() => emit('action', 'export-json'))
    },
    {
      id: 'export-csv',
      group: 'Данные',
      label: 'Выгрузить задачи (CSV)',
      icon: 'download',
      run: done(() => emit('action', 'export-csv'))
    },
    {
      id: 'import',
      group: 'Данные',
      label: 'Восстановить из бэкапа',
      icon: 'upload',
      run: done(() => emit('action', 'import'))
    },
    {
      id: 'sample',
      group: 'Данные',
      label: 'Загрузить пример',
      icon: 'sparkles',
      run: done(() => emit('action', 'sample'))
    },
    {
      id: 'settings',
      group: 'Данные',
      label: 'Настройки, хранение и AI',
      icon: 'settings',
      run: done(() => emit('action', 'settings'))
    }
  )

  return list
})

const filtered = computed<Command[]>(() => {
  const needle = query.value.trim()
  if (needle === '') {
    // Без запроса задачи вытеснили бы команды из списка.
    return commands.value
      .filter((command) => command.group !== 'Задачи' && command.group !== 'Запустить таймер')
      .slice(0, 40)
  }
  return commands.value
    .filter((command) => subsequenceMatch(`${command.group} ${command.label}`, needle))
    .slice(0, 40)
})

/** Плоский список строк с заголовками групп. */
const rows = computed<Array<{ kind: 'group'; label: string } | { kind: 'item'; command: Command; index: number }>>(
  () => {
    const result: Array<{ kind: 'group'; label: string } | { kind: 'item'; command: Command; index: number }> = []
    let lastGroup = ''
    filtered.value.forEach((command, index) => {
      if (command.group !== lastGroup) {
        result.push({ kind: 'group', label: command.group })
        lastGroup = command.group
      }
      result.push({ kind: 'item', command, index })
    })
    return result
  }
)

watch(filtered, () => {
  active.value = 0
})

function move(delta: number): void {
  const count = filtered.value.length
  if (count === 0) return
  active.value = (active.value + delta + count) % count
  void nextTick(() => {
    listRef.value?.querySelector('.palette__item--active')?.scrollIntoView({ block: 'nearest' })
  })
}

function runActive(): void {
  filtered.value[active.value]?.run()
}
</script>

<template>
  <div v-if="props.open" class="overlay" @click.self="emit('close')">
    <div class="modal modal--palette" role="dialog" aria-modal="true" aria-label="Палитра команд">
      <div class="palette__search">
        <Icon name="search" :size="17" />
        <input
          ref="inputRef"
          v-model="query"
          class="palette__input"
          placeholder="Поиск команд, целей, задач…"
          aria-label="Поиск команд"
          autocomplete="off"
          spellcheck="false"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="runActive"
          @keydown.esc="emit('close')"
        />
        <span class="kbd">esc</span>
      </div>

      <div ref="listRef" class="palette__list">
        <p v-if="filtered.length === 0" class="text-sm faint" style="padding: var(--space-4); text-align: center">
          По запросу «{{ query }}» ничего не найдено.
        </p>

        <template v-for="(row, rowIndex) in rows" :key="rowIndex">
          <div v-if="row.kind === 'group'" class="palette__group">{{ row.label }}</div>
          <button
            v-else
            class="palette__item"
            :class="{ 'palette__item--active': row.index === active }"
            @click="row.command.run()"
            @mousemove="active = row.index"
          >
            <Icon :name="row.command.icon" :size="15" />
            <span class="palette__label">{{ row.command.label }}</span>
            <span v-if="row.command.hint" class="palette__sub mono truncate" style="max-width: 140px">
              {{ row.command.hint }}
            </span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

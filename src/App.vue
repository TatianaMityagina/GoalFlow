<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import Icon from './components/Icon.vue'
import SidebarNav from './components/SidebarNav.vue'
import FilterBar from './components/FilterBar.vue'
import TaskListView from './components/TaskListView.vue'
import TaskBoardView from './components/TaskBoardView.vue'
import TaskCalendarView from './components/TaskCalendarView.vue'
import TaskDetail from './components/TaskDetail.vue'
import QuickCapture from './components/QuickCapture.vue'
import CommandPalette from './components/CommandPalette.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import EntityDialog from './components/EntityDialog.vue'
import StatsPanel from './components/StatsPanel.vue'
import TimerBar from './components/TimerBar.vue'
import ToastHost from './components/ToastHost.vue'
import { store } from './stores/store'
import { useHotkeys } from './composables/useHotkeys'
import { downloadFile, formatMinutes, todayISO } from './lib/utils'
import type { ID } from './types'

/* Состояние оболочки */

const sidebarOpen = ref<boolean>(false)
const paletteOpen = ref<boolean>(false)
const captureOpen = ref<boolean>(false)
const settingsOpen = ref<boolean>(false)
const statsOpen = ref<boolean>(false)
const entityDialog = ref<{
  open: boolean
  kind: 'goal' | 'project'
  presetGoalId: ID | null
  editId: ID | null
}>({ open: false, kind: 'goal', presetGoalId: null, editId: null })
const filterBar = ref<InstanceType<typeof FilterBar> | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

// Тема проставляется атрибутом; `system` его снимает и отдаёт выбор ОС.
watchEffect(() => {
  const theme = store.db.settings.theme
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
})

const anyOverlayOpen = computed<boolean>(
  () =>
    paletteOpen.value ||
    captureOpen.value ||
    settingsOpen.value ||
    entityDialog.value.open ||
    store.openTaskId.value !== null
)

function closeOverlays(): void {
  if (store.openTaskId.value !== null) {
    store.openTaskId.value = null
    return
  }
  paletteOpen.value = false
  captureOpen.value = false
  settingsOpen.value = false
  entityDialog.value.open = false
  sidebarOpen.value = false
}

function openEntity(kind: 'goal' | 'project', presetGoalId: ID | null = null): void {
  entityDialog.value = { open: true, kind, presetGoalId, editId: null }
}

function editEntity(kind: 'goal' | 'project', id: ID): void {
  entityDialog.value = { open: true, kind, presetGoalId: null, editId: id }
}

function exportBackup(): void {
  downloadFile(`goalflow-backup-${todayISO()}.json`, store.exportJSON(), 'application/json')
  store.pushToast('Бэкап выгружен', 'success')
}

function exportTasks(): void {
  downloadFile(`goalflow-tasks-${todayISO()}.csv`, store.exportTasksCSV(), 'text/csv')
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file === undefined) return
  store.importJSON(await file.text(), 'merge')
  input.value = ''
}

function onPaletteAction(name: Parameters<typeof handleAction>[0]): void {
  handleAction(name)
}

function handleAction(
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
): void {
  switch (name) {
    case 'quick-capture':
      captureOpen.value = true
      break
    case 'new-goal':
      openEntity('goal')
      break
    case 'new-project':
      openEntity('project', store.selectedGoalId.value)
      break
    case 'settings':
      settingsOpen.value = true
      break
    case 'stats':
      statsOpen.value = true
      break
    case 'export-json':
      exportBackup()
      break
    case 'export-csv':
      exportTasks()
      break
    case 'import':
      importInput.value?.click()
      break
    case 'sample':
      store.loadSampleData()
      break
  }
}

/* Горячие клавиши */

useHotkeys(() => [
  { key: 'k', meta: true, allowInInput: true, run: () => (paletteOpen.value = !paletteOpen.value) },
  { key: 'escape', allowInInput: true, run: closeOverlays },
  { key: 'n', run: () => (captureOpen.value = true) },
  { key: 'g', run: () => openEntity('goal') },
  { key: 'p', run: () => openEntity('project', store.selectedGoalId.value) },
  { key: '/', run: () => filterBar.value?.focusSearch() },
  { key: 'e', run: exportBackup },
  { key: '?', shift: true, run: () => (settingsOpen.value = true) },
  { key: 't', run: () => store.stopTimer() },
  {
    key: '1',
    run: () => {
      statsOpen.value = false
      store.viewMode.value = 'list'
    }
  },
  {
    key: '2',
    run: () => {
      statsOpen.value = false
      store.viewMode.value = 'board'
    }
  },
  {
    key: '3',
    run: () => {
      statsOpen.value = false
      store.viewMode.value = 'calendar'
    }
  }
])

/* Заголовок */

const heading = computed<string>(() => {
  if (statsOpen.value) return 'Время и наблюдения'
  const project = store.projectById(store.selectedProjectId.value)
  if (project !== null) return project.title
  const goal = store.goalById(store.selectedGoalId.value)
  if (goal !== null) return goal.title
  const view = store.db.savedViews.find((candidate) => candidate.id === store.activeViewId.value)
  return view?.name ?? 'Все задачи'
})

const isEmptyWorkspace = computed<boolean>(
  () => store.db.tasks.length === 0 && store.db.goals.length === 0 && store.db.projects.length === 0
)
</script>

<template>
  <div class="shell">
    <aside
      class="shell__sidebar"
      :class="{ 'shell__sidebar--open': sidebarOpen }"
    >
      <SidebarNav
        @navigate="sidebarOpen = false; statsOpen = false"
        @open-settings="settingsOpen = true"
        @open-stats="statsOpen = true; sidebarOpen = false"
        @new-goal="openEntity('goal')"
        @new-project="openEntity('project', $event)"
        @edit-goal="editEntity('goal', $event)"
        @edit-project="editEntity('project', $event)"
      />
    </aside>

    <button
      v-if="sidebarOpen"
      class="shell__scrim hide-lg"
      aria-label="Закрыть навигацию"
      @click="sidebarOpen = false"
    />


    <main class="shell__main">
      <header class="topbar">
        <button
          class="btn btn--ghost btn--icon hide-lg"
          aria-label="Открыть навигацию"
          :aria-expanded="sidebarOpen"
          @click="sidebarOpen = true"
        >
          <Icon name="menu" :size="18" />
        </button>

        <h1 class="topbar__title">{{ heading }}</h1>
        <span v-if="!statsOpen" class="topbar__count">{{ store.visibleTasks.value.length }}</span>

        <span class="topbar__spacer" />

        <div class="topbar__actions">
          <span
            v-if="store.todayMinutes.value > 0"
            class="badge hide-sm"
            title="Учтено времени сегодня"
          >
            <Icon name="clock" :size="10" />
            {{ formatMinutes(store.todayMinutes.value) }}
          </span>

          <button class="btn btn--ghost btn--icon" aria-label="Палитра команд (Cmd+K)" @click="paletteOpen = true">
            <Icon name="search" :size="17" />
          </button>
          <button class="btn btn--primary" title="Новая задача (N)" @click="captureOpen = true">
            <Icon name="plus" :size="15" />
            <span class="hide-sm">Новая задача</span>
          </button>
        </div>
      </header>

      <div class="content">
        <div class="content__inner">
          <StatsPanel v-if="statsOpen" @close="statsOpen = false" />

          <template v-else>
            <FilterBar ref="filterBar" />

            <div v-if="isEmptyWorkspace" class="empty">
              <div class="empty__icon"><Icon name="target" :size="22" /></div>
              <h2 class="empty__title">Начните с цели, а не со списка</h2>
              <p class="empty__text">
                GoalFlow держит задачи привязанными к причине, по которой вы их делаете, и считает
                время прямо в задаче — второе приложение не нужно. Данные не покидают это устройство.
              </p>
              <div class="empty__actions">
                <button class="btn btn--primary btn--lg" @click="openEntity('goal')">
                  <Icon name="target" :size="15" /> Создать цель
                </button>
                <button class="btn btn--default btn--lg" @click="captureOpen = true">
                  <Icon name="plus" :size="15" /> Просто добавить задачу
                </button>
                <button class="btn btn--ghost btn--lg" @click="store.loadSampleData()">
                  <Icon name="sparkles" :size="15" /> Загрузить пример
                </button>
              </div>
              <p class="empty__text faint" style="margin-top: var(--space-4)">
                <span class="kbd">⌘K</span> команды · <span class="kbd">N</span> новая задача ·
                <span class="kbd">/</span> фильтр · <span class="kbd">?</span> все клавиши
              </p>
            </div>

            <template v-else>
              <TaskListView v-if="store.viewMode.value === 'list'" />
              <TaskBoardView v-else-if="store.viewMode.value === 'board'" />
              <TaskCalendarView v-else />
            </template>
          </template>
        </div>
      </div>

      <TimerBar />
    </main>

    <TaskDetail />
    <QuickCapture :open="captureOpen" @close="captureOpen = false" />
    <CommandPalette
      :open="paletteOpen"
      @close="paletteOpen = false"
      @action="onPaletteAction"
      @edit-goal="editEntity('goal', $event)"
      @edit-project="editEntity('project', $event)"
    />
    <SettingsDialog :open="settingsOpen" @close="settingsOpen = false" />
    <EntityDialog
      :open="entityDialog.open"
      :kind="entityDialog.kind"
      :preset-goal-id="entityDialog.presetGoalId"
      :edit-id="entityDialog.editId"
      @close="entityDialog.open = false"
    />
    <ToastHost />

    <input
      ref="importInput"
      type="file"
      accept="application/json,.json"
      class="sr-only"
      @change="onImportFile"
    />

    <span class="sr-only" aria-live="polite">
      {{ anyOverlayOpen ? 'Открыто диалоговое окно. Нажмите Escape, чтобы закрыть.' : '' }}
    </span>
  </div>
</template>

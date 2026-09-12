<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import type { Goal, ID } from '@/types'
import { formatMinutes, plural } from '@/lib/utils'

const emit = defineEmits<{
  (event: 'navigate'): void
  (event: 'open-settings'): void
  (event: 'open-stats'): void
  (event: 'new-goal'): void
  (event: 'new-project', goalId: ID | null): void
  (event: 'edit-goal', goalId: ID): void
  (event: 'edit-project', projectId: ID): void
}>()

const expanded = ref<Set<ID>>(new Set())

function toggleExpanded(goalId: ID): void {
  const next = new Set(expanded.value)
  if (next.has(goalId)) next.delete(goalId)
  else next.add(goalId)
  expanded.value = next
}

const activeGoals = computed<Goal[]>(() => store.db.goals.filter((goal) => !goal.archived))

const taskWord = computed<string>(() =>
  plural(store.db.tasks.length, 'задача', 'задачи', 'задач')
)

/** Задачи без проекта и без цели. */
const looseCount = computed<number>(
  () =>
    store.db.tasks.filter(
      (task) => task.status !== 'done' && task.projectIds.length === 0 && task.goalIds.length === 0
    ).length
)

function openCount(goalId: ID): number {
  return store.tasksOfGoal(goalId).filter((task) => task.status !== 'done').length
}

function projectOpenCount(projectId: ID): number {
  return store.tasksOfProject(projectId).filter((task) => task.status !== 'done').length
}

function selectGoal(goal: Goal): void {
  store.selectedProjectId.value = null
  store.selectedGoalId.value = store.selectedGoalId.value === goal.id ? null : goal.id
  store.activeViewId.value = null
  emit('navigate')
}

function selectProject(projectId: ID, goalId: ID): void {
  store.selectedGoalId.value = goalId
  store.selectedProjectId.value = store.selectedProjectId.value === projectId ? null : projectId
  store.activeViewId.value = null
  emit('navigate')
}

function selectInbox(): void {
  store.clearFilters()
  store.searchQuery.value = 'цель:нет проект:нет'
  emit('navigate')
}

function selectAll(): void {
  store.clearFilters()
  emit('navigate')
}

function applyView(viewId: ID): void {
  const view = store.db.savedViews.find((candidate) => candidate.id === viewId)
  if (view) store.applyView(view)
  emit('navigate')
}

function selectTag(tag: string): void {
  store.clearFilters()
  store.searchQuery.value = `тег:${tag}`
  emit('navigate')
}

const isAllActive = computed<boolean>(
  () =>
    store.searchQuery.value === '' &&
    store.selectedGoalId.value === null &&
    store.activeViewId.value === null
)

const isInboxActive = computed<boolean>(() => store.searchQuery.value === 'цель:нет проект:нет')

function goalMeta(goalId: ID): string {
  const progress = store.goalProgress.value.get(goalId)
  if (progress === undefined || progress.total === 0) return 'Пока нет задач'
  return `${progress.done}/${progress.total} · ${formatMinutes(progress.spentMinutes)}`
}

const topTags = computed<string[]>(() => {
  const counts = new Map<string, number>()
  for (const task of store.db.tasks) {
    if (task.status === 'done') continue
    for (const tag of task.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag)
})

function cycleTheme(): void {
  const order = ['system', 'light', 'dark'] as const
  const current = store.db.settings.theme
  const next = order[(order.indexOf(current) + 1) % order.length] ?? 'system'
  store.updateSettings({ theme: next })
}

const THEME_NAMES: Record<string, string> = {
  system: 'как в системе',
  light: 'светлая',
  dark: 'тёмная'
}

const themeLabel = computed<string>(() => {
  if (store.db.settings.theme === 'light') return 'Светлая тема'
  if (store.db.settings.theme === 'dark') return 'Тёмная тема'
  return 'Тема как в системе'
})
</script>

<template>
  <nav class="side" aria-label="Цели и виды">
    <div class="brand">
      <div class="brand__mark"><Icon name="target" :size="17" /></div>
      <div class="truncate">
        <div class="brand__name">GoalFlow</div>
        <div class="brand__sub">Локально · {{ store.db.tasks.length }} {{ taskWord }}</div>
      </div>
    </div>

    <div class="side__scroll">
      <button class="nav-item" :class="{ 'nav-item--active': isAllActive }" @click="selectAll">
        <Icon name="list" :size="15" />
        <span class="nav-item__label">Все задачи</span>
        <span class="nav-item__count">{{ store.db.tasks.filter((t) => t.status !== 'done').length }}</span>
      </button>

      <button class="nav-item" :class="{ 'nav-item--active': isInboxActive }" @click="selectInbox">
        <Icon name="inbox" :size="15" />
        <span class="nav-item__label">Без разбора</span>
        <span class="nav-item__count">{{ looseCount }}</span>
      </button>

      <button class="nav-item" @click="emit('open-stats')">
        <Icon name="chart" :size="15" />
        <span class="nav-item__label">Время и наблюдения</span>
      </button>

      <section class="side__section">
        <h2 class="side__heading">
          <Icon name="bookmark" :size="12" />
          <span>Виды</span>
        </h2>
        <button
          v-for="view in store.db.savedViews"
          :key="view.id"
          class="nav-item"
          :class="{ 'nav-item--active': store.activeViewId.value === view.id }"
          @click="applyView(view.id)"
        >
          <Icon name="filter" :size="15" />
          <span class="nav-item__label">{{ view.name }}</span>
          <span
            v-if="!view.builtin"
            class="nav-item__remove"
            role="button"
            tabindex="0"
            :aria-label="`Удалить вид ${view.name}`"
            @click.stop="store.deleteView(view.id)"
            @keydown.enter.stop="store.deleteView(view.id)"
          >
            <Icon name="close" :size="13" />
          </span>
        </button>
      </section>

      <section class="side__section">
        <h2 class="side__heading">
          <Icon name="target" :size="12" />
          <span>Цели</span>
          <span class="side__heading-spacer" />
          <button class="btn btn--ghost btn--sm btn--icon" aria-label="Новая цель" @click="emit('new-goal')">
            <Icon name="plus" :size="13" />
          </button>
        </h2>

        <p v-if="activeGoals.length === 0" class="text-xs faint" style="padding: var(--space-2)">
          Целей пока нет. Цель отвечает на вопрос «зачем я это делаю».
        </p>

        <div
          v-for="goal in activeGoals"
          :key="goal.id"
          class="goal-row"
          :class="{ 'goal-row--active': store.selectedGoalId.value === goal.id }"
        >
          <div class="goal-row__top">
            <button
              class="btn btn--ghost btn--sm btn--icon"
              :aria-label="expanded.has(goal.id) ? 'Свернуть проекты' : 'Развернуть проекты'"
              :aria-expanded="expanded.has(goal.id)"
              @click="toggleExpanded(goal.id)"
            >
              <Icon :name="expanded.has(goal.id) ? 'chevronDown' : 'chevronRight'" :size="13" />
            </button>
            <span class="nav-item__dot" :style="{ background: goal.color }" />
            <button class="goal-row__title" @click="selectGoal(goal)">{{ goal.title }}</button>
            <button
              class="btn btn--ghost btn--sm btn--icon nav-item__remove"
              :aria-label="`Изменить цель ${goal.title}`"
              @click.stop="emit('edit-goal', goal.id)"
            >
              <Icon name="edit" :size="13" />
            </button>
            <span class="nav-item__count">{{ openCount(goal.id) }}</span>
          </div>

          <div class="goal-row__meta">
            <div class="progress">
              <div
                class="progress__fill"
                :style="{
                  width: `${store.goalProgress.value.get(goal.id)?.percent ?? 0}%`,
                  background: goal.color
                }"
              />
            </div>
            <span class="nowrap">{{ store.goalProgress.value.get(goal.id)?.percent ?? 0 }}%</span>
          </div>
          <div class="goal-row__meta">
            <span class="truncate">{{ goalMeta(goal.id) }}</span>
          </div>

          <div v-if="expanded.has(goal.id)" class="goal-row__children">
            <button
              v-for="project in store.projectsOfGoal(goal.id)"
              :key="project.id"
              class="nav-item"
              :class="{ 'nav-item--active': store.selectedProjectId.value === project.id }"
              @click="selectProject(project.id, goal.id)"
            >
              <Icon name="folder" :size="14" />
              <span class="nav-item__label">{{ project.title }}</span>
              <span
                class="nav-item__remove"
                role="button"
                tabindex="0"
                :aria-label="`Изменить проект ${project.title}`"
                @click.stop="emit('edit-project', project.id)"
                @keydown.enter.stop="emit('edit-project', project.id)"
              >
                <Icon name="edit" :size="12" />
              </span>
              <span class="nav-item__count">{{ projectOpenCount(project.id) }}</span>
            </button>
            <button class="nav-item" @click="emit('new-project', goal.id)">
              <Icon name="plus" :size="14" />
              <span class="nav-item__label">Новый проект</span>
            </button>
          </div>
        </div>
      </section>

      <section v-if="store.db.projects.some((p) => p.goalIds.length === 0)" class="side__section">
        <h2 class="side__heading">
          <Icon name="folder" :size="12" />
          <span>Проекты без цели</span>
        </h2>
        <button
          v-for="project in store.db.projects.filter((p) => p.goalIds.length === 0)"
          :key="project.id"
          class="nav-item"
          :class="{ 'nav-item--active': store.selectedProjectId.value === project.id }"
          @click="
            store.selectedGoalId.value = null;
            store.selectedProjectId.value =
              store.selectedProjectId.value === project.id ? null : project.id;
            emit('navigate')
          "
        >
          <Icon name="folder" :size="14" />
          <span class="nav-item__label">{{ project.title }}</span>
          <span
            class="nav-item__remove"
            role="button"
            tabindex="0"
            :aria-label="`Изменить проект ${project.title}`"
            @click.stop="emit('edit-project', project.id)"
            @keydown.enter.stop="emit('edit-project', project.id)"
          >
            <Icon name="edit" :size="12" />
          </span>
          <span class="nav-item__count">{{ projectOpenCount(project.id) }}</span>
        </button>
      </section>

      <section v-if="topTags.length > 0" class="side__section">
        <h2 class="side__heading">
          <Icon name="tag" :size="12" />
          <span>Теги</span>
        </h2>
        <div class="tagline" style="padding: var(--space-1) var(--space-2)">
          <button v-for="tag in topTags" :key="tag" class="badge badge--tag" @click="selectTag(tag)">
            {{ tag }}
          </button>
        </div>
      </section>
    </div>

    <div class="side__foot">
      <button class="btn btn--ghost btn--sm" :title="themeLabel" :aria-label="themeLabel" @click="cycleTheme">
        <Icon :name="store.db.settings.theme === 'dark' ? 'moon' : 'sun'" :size="15" />
        <span class="text-xs">{{ THEME_NAMES[store.db.settings.theme] }}</span>
      </button>
      <span class="spacer" />
      <button class="btn btn--ghost btn--sm btn--icon" aria-label="Настройки, данные и AI" @click="emit('open-settings')">
        <Icon name="settings" :size="15" />
      </button>
    </div>
  </nav>
</template>

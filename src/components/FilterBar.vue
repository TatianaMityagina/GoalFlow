<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import { suggestQueryTokens, type QuerySuggestion } from '@/lib/query'
import type { ViewMode } from '@/types'

const searchInput = ref<HTMLInputElement | null>(null)
const suggestOpen = ref<boolean>(false)
const highlighted = ref<number>(0)

defineExpose({
  focusSearch: (): void => {
    searchInput.value?.focus()
    searchInput.value?.select()
  }
})

// Подсказки подбираются под набираемый токен, а не под весь запрос.
const currentFragment = computed<string>(() => {
  const value = store.searchQuery.value
  const lastSpace = value.lastIndexOf(' ')
  return lastSpace === -1 ? value : value.slice(lastSpace + 1)
})

const suggestions = computed<QuerySuggestion[]>(() => suggestQueryTokens(currentFragment.value))

function applySuggestion(suggestion: QuerySuggestion): void {
  const value = store.searchQuery.value
  const lastSpace = value.lastIndexOf(' ')
  const prefix = lastSpace === -1 ? '' : `${value.slice(0, lastSpace)} `
  store.searchQuery.value = `${prefix}${suggestion.insert} `
  store.activeViewId.value = null
  highlighted.value = 0
  void nextTick(() => searchInput.value?.focus())
}

// Закрытие отложено, иначе blur срабатывает раньше клика по подсказке.
function closeSuggestSoon(): void {
  window.setTimeout(() => {
    suggestOpen.value = false
  }, 140)
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (!suggestOpen.value || suggestions.value.length === 0) {
    if (event.key === 'Escape') searchInput.value?.blur()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    highlighted.value = (highlighted.value + 1) % suggestions.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    highlighted.value = (highlighted.value - 1 + suggestions.value.length) % suggestions.value.length
  } else if (event.key === 'Tab' || (event.key === 'Enter' && currentFragment.value !== '')) {
    const suggestion = suggestions.value[highlighted.value]
    if (suggestion !== undefined) {
      event.preventDefault()
      applySuggestion(suggestion)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    suggestOpen.value = false
  }
}

const MODES: Array<{ id: ViewMode; label: string; icon: 'list' | 'board' | 'calendar' }> = [
  { id: 'list', label: 'Список', icon: 'list' },
  { id: 'board', label: 'Доска', icon: 'board' },
  { id: 'calendar', label: 'Календарь', icon: 'calendar' }
]

const hasFilters = computed<boolean>(
  () =>
    store.searchQuery.value.trim() !== '' ||
    store.selectedGoalId.value !== null ||
    store.selectedProjectId.value !== null
)

const savingView = ref<boolean>(false)
const newViewName = ref<string>('')

function saveView(): void {
  if (newViewName.value.trim() === '') return
  store.saveCurrentView(newViewName.value)
  newViewName.value = ''
  savingView.value = false
}

/** Цель или проект, выбранные в сайдбаре. */
const scopeLabel = computed<string | null>(() => {
  const project = store.projectById(store.selectedProjectId.value)
  if (project !== null) return project.title
  const goal = store.goalById(store.selectedGoalId.value)
  return goal?.title ?? null
})
</script>

<template>
  <div class="filterbar">
    <div class="filterbar__row">
      <div class="search">
        <span class="search__icon"><Icon name="search" :size="15" /></span>
        <input
          ref="searchInput"
          v-model="store.searchQuery.value"
          class="input"
          type="text"
          placeholder="статус:вработе срок:неделя #дизайн …"
          aria-label="Фильтр задач"
          autocomplete="off"
          spellcheck="false"
          @focus="suggestOpen = true"
          @blur="closeSuggestSoon"
          @input="store.activeViewId.value = null"
          @keydown="onSearchKeydown"
        />
        <button
          v-if="store.searchQuery.value !== ''"
          class="btn btn--ghost btn--sm btn--icon search__clear"
          aria-label="Сбросить фильтр"
          @click="store.searchQuery.value = ''"
        >
          <Icon name="close" :size="13" />
        </button>

        <div v-if="suggestOpen && suggestions.length > 0" class="suggest" role="listbox">
          <button
            v-for="(suggestion, index) in suggestions"
            :key="suggestion.insert"
            class="suggest__item"
            :class="{ 'suggest__item--active': index === highlighted }"
            role="option"
            :aria-selected="index === highlighted"
            @mousedown.prevent="applySuggestion(suggestion)"
          >
            <span class="suggest__token">{{ suggestion.insert }}</span>
            <span class="suggest__hint">{{ suggestion.hint }}</span>
          </button>
        </div>
      </div>

      <div class="segmented" role="tablist" aria-label="Режим отображения">
        <button
          v-for="mode in MODES"
          :key="mode.id"
          class="segmented__btn"
          :class="{ 'segmented__btn--active': store.viewMode.value === mode.id }"
          role="tab"
          :aria-selected="store.viewMode.value === mode.id"
          :title="mode.label"
          @click="store.viewMode.value = mode.id"
        >
          <Icon :name="mode.icon" :size="14" />
          <span class="hide-sm">{{ mode.label }}</span>
        </button>
      </div>
    </div>

    <div class="filterbar__row">
      <div class="chips">
        <button
          v-if="scopeLabel !== null"
          class="chip chip--active"
          @click="
            store.selectedProjectId.value = null;
            store.selectedGoalId.value = null
          "
        >
          {{ scopeLabel }}
          <span class="chip__remove"><Icon name="close" :size="11" /></span>
        </button>

        <button
          v-for="view in store.db.savedViews"
          :key="view.id"
          class="chip"
          :class="{ 'chip--active': store.activeViewId.value === view.id }"
          @click="store.applyView(view)"
        >
          {{ view.name }}
        </button>
      </div>

      <span class="spacer" />

      <label class="row text-xs muted nowrap" style="gap: 6px">
        <input v-model="store.showCompleted.value" class="checkbox" type="checkbox" />
        <span>Показывать готовые</span>
      </label>

      <button
        v-if="hasFilters && !savingView"
        class="btn btn--ghost btn--sm"
        title="Сохранить этот фильтр как вид"
        @click="savingView = true"
      >
        <Icon name="bookmark" :size="13" />
        <span class="hide-sm">Сохранить вид</span>
      </button>

      <button v-if="hasFilters" class="btn btn--ghost btn--sm" @click="store.clearFilters()">
        <Icon name="close" :size="13" />
        <span class="hide-sm">Сбросить</span>
      </button>
    </div>

    <div v-if="savingView" class="filterbar__row">
      <input
        v-model="newViewName"
        class="input"
        style="max-width: 240px"
        placeholder="Название вида"
        autofocus
        @keydown.enter="saveView"
        @keydown.esc="savingView = false"
      />
      <button class="btn btn--primary btn--sm" @click="saveView">Сохранить</button>
      <button class="btn btn--ghost btn--sm" @click="savingView = false">Отмена</button>
    </div>
  </div>
</template>

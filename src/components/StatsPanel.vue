<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import type { Breakdown } from '@/stores/store'
import { formatMinutes, plural, toISODate } from '@/lib/utils'
import {
  buildInsights,
  buildLocalReport,
  claudeReady,
  reportWithClaude,
  type Insight,
  type InsightContext
} from '@/lib/ai'

const emit = defineEmits<{ (event: 'close'): void }>()

const rangeDays = ref<number>(14)

const daily = computed(() => store.dailyTotals(rangeDays.value))
const peak = computed<number>(() => Math.max(1, ...daily.value.map((day) => day.minutes)))
const today = toISODate(new Date())

const rangeMinutes = computed<number>(() => daily.value.reduce((sum, day) => sum + day.minutes, 0))

const activeDays = computed<number>(() => daily.value.filter((day) => day.minutes > 0).length)

const dailyAverage = computed<number>(() =>
  activeDays.value === 0 ? 0 : Math.round(rangeMinutes.value / activeDays.value)
)

const completedInRange = computed<number>(() => {
  const since = new Date(Date.now() - rangeDays.value * 86_400_000).toISOString()
  return store.db.tasks.filter((task) => task.completedAt !== null && task.completedAt >= since).length
})

function barLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`)
  return date.toLocaleDateString('ru-RU', { weekday: 'narrow' })
}

function share(rows: Breakdown[], minutes: number): number {
  const total = rows.reduce((sum, row) => sum + row.minutes, 0)
  return total === 0 ? 0 : Math.round((minutes / total) * 100)
}

/* ----------------------------- наблюдения ---------------------------- */

const insightContext = computed<InsightContext>(() => {
  const entriesByDay = new Map<string, number>()
  store.dailyTotals(90).forEach((day) => entriesByDay.set(day.day, day.minutes))
  return {
    goals: store.db.goals,
    projects: store.db.projects,
    tasks: store.db.tasks,
    spentMinutes: store.spentMinutes,
    entriesByDay
  }
})

const insights = computed<Insight[]>(() => buildInsights(insightContext.value))

function applyInsight(insight: Insight): void {
  if (insight.query === undefined) return
  store.clearFilters()
  store.searchQuery.value = insight.query
  emit('close')
}

/* -------------------------------- отчёт ------------------------------ */

const report = ref<string>('')
const reportBusy = ref<boolean>(false)
const reportSource = ref<'local' | 'claude'>('local')

async function generateReport(): Promise<void> {
  reportBusy.value = true
  try {
    if (claudeReady(store.db.settings)) {
      report.value = await reportWithClaude(insightContext.value, rangeDays.value, store.db.settings)
      reportSource.value = 'claude'
    } else {
      report.value = buildLocalReport(insightContext.value, rangeDays.value)
      reportSource.value = 'local'
    }
  } catch (error) {
    report.value = buildLocalReport(insightContext.value, rangeDays.value)
    reportSource.value = 'local'
    store.pushToast(
      error instanceof Error ? `Claude недоступен: ${error.message}` : 'Claude недоступен',
      'warning'
    )
  } finally {
    reportBusy.value = false
  }
}

async function copyReport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(report.value)
    store.pushToast('Отчёт скопирован', 'success')
  } catch {
    store.pushToast('Буфер обмена недоступен — выделите текст и скопируйте вручную', 'warning')
  }
}

const RANGES = [7, 14, 30, 90]
</script>

<template>
  <div class="stack">
    <div class="row row--wrap">
      <h2 style="font-size: var(--text-xl)">Время и наблюдения</h2>
      <span class="spacer" />
      <div class="segmented">
        <button
          v-for="days in RANGES"
          :key="days"
          class="segmented__btn"
          :class="{ 'segmented__btn--active': rangeDays === days }"
          @click="rangeDays = days"
        >
          {{ days }} дн.
        </button>
      </div>
      <button class="btn btn--ghost btn--sm" @click="emit('close')">
        <Icon name="close" :size="14" />
        <span class="hide-sm">К задачам</span>
      </button>
    </div>

    <div class="panel">
      <div class="stat-row">
        <div class="stat">
          <span class="stat__value">{{ formatMinutes(store.todayMinutes.value) }}</span>
          <span class="stat__label">Сегодня</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ formatMinutes(store.weekMinutes.value) }}</span>
          <span class="stat__label">За неделю</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ formatMinutes(dailyAverage) }}</span>
          <span class="stat__label">В активный день</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ completedInRange }}</span>
          <span class="stat__label">Завершено за {{ rangeDays }} дн.</span>
        </div>
      </div>

      <div class="bars" :aria-label="`Учтённые минуты по дням за последние ${rangeDays} дней`">
        <div v-for="day in daily" :key="day.day" class="bars__col" :title="`${day.day}: ${formatMinutes(day.minutes)}`">
          <div
            class="bars__bar"
            :class="{ 'bars__bar--empty': day.minutes === 0, 'bars__bar--today': day.day === today }"
            :style="{ height: `${Math.max(2, (day.minutes / peak) * 100)}%` }"
          />
          <span v-if="rangeDays <= 14" class="bars__label">{{ barLabel(day.day) }}</span>
        </div>
      </div>
      <p class="field__hint" style="margin-top: var(--space-2)">
        Учтено {{ formatMinutes(rangeMinutes) }} за {{ activeDays }}
        {{ plural(activeDays, 'активный день', 'активных дня', 'активных дней') }}.
      </p>
    </div>

    <div class="grid-panels">
      <section class="panel">
        <header class="panel__head">
          <Icon name="target" :size="14" />
          <h3 class="panel__title">Куда ушло время — по целям</h3>
        </header>
        <p v-if="store.minutesByGoal.value.length === 0" class="field__hint">
          Время ещё не учитывалось. Запустите таймер на любой задаче или внесите время вручную.
        </p>
        <div v-else class="breakdown">
          <div v-for="row in store.minutesByGoal.value" :key="row.id" class="breakdown__row">
            <div class="breakdown__top">
              <span class="nav-item__dot" :style="{ background: row.color }" />
              <span class="breakdown__label">{{ row.label }}</span>
              <span class="breakdown__value">{{ formatMinutes(row.minutes) }}</span>
            </div>
            <div class="progress">
              <div
                class="progress__fill"
                :style="{ width: `${share(store.minutesByGoal.value, row.minutes)}%`, background: row.color }"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <header class="panel__head">
          <Icon name="folder" :size="14" />
          <h3 class="panel__title">По проектам</h3>
        </header>
        <p v-if="store.minutesByProject.value.length === 0" class="field__hint">Пока ничего не учтено.</p>
        <div v-else class="breakdown">
          <div v-for="row in store.minutesByProject.value" :key="row.id" class="breakdown__row">
            <div class="breakdown__top">
              <span class="nav-item__dot" :style="{ background: row.color }" />
              <span class="breakdown__label">{{ row.label }}</span>
              <span class="breakdown__value">{{ formatMinutes(row.minutes) }}</span>
            </div>
            <div class="progress">
              <div
                class="progress__fill"
                :style="{ width: `${share(store.minutesByProject.value, row.minutes)}%`, background: row.color }"
              />
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="panel">
      <header class="panel__head">
        <Icon name="sparkles" :size="14" />
        <h3 class="panel__title">Что бросается в глаза</h3>
        <span class="text-xs faint">посчитано на вашем устройстве</span>
      </header>
      <p v-if="insights.length === 0" class="field__hint">
        Отмечать нечего: просроченного нет, застрявшего нет, потерянных задач нет.
      </p>
      <div v-else class="stack stack--sm">
        <component
          :is="insight.query === undefined ? 'div' : 'button'"
          v-for="insight in insights"
          :key="insight.title"
          class="insight"
          @click="applyInsight(insight)"
        >
          <span class="insight__title">{{ insight.title }}</span>
          <span class="insight__detail">{{ insight.detail }}</span>
          <span v-if="insight.query !== undefined" class="text-xs mono" style="color: var(--accent-text)">
            {{ insight.query }}
          </span>
        </component>
      </div>
    </section>

    <section class="panel">
      <header class="panel__head">
        <Icon name="edit" :size="14" />
        <h3 class="panel__title">Сводка простым языком</h3>
        <span class="spacer" />
        <button class="btn btn--default btn--sm" :disabled="reportBusy" @click="generateReport">
          <Icon name="sparkles" :size="13" :class="reportBusy ? 'spin' : ''" />
          {{ reportBusy ? 'Пишу…' : `Сводка за ${rangeDays} дн.` }}
        </button>
      </header>
      <p class="field__hint">
        {{
          claudeReady(store.db.settings)
            ? 'Claude напишет её по вашим завершённым задачам и учтённому времени.'
            : 'Собрана локально по вашим данным. Включите AI в настройках, чтобы текст был связным.'
        }}
      </p>
      <div v-if="report !== ''" class="stack stack--sm" style="margin-top: var(--space-3)">
        <pre class="report">{{ report }}</pre>
        <div class="row">
          <span class="text-xs faint">{{ reportSource === 'claude' ? 'Написано Claude' : 'Собрано локально' }}</span>
          <span class="spacer" />
          <button class="btn btn--ghost btn--sm" @click="copyReport">Копировать</button>
        </div>
      </div>
    </section>
  </div>
</template>

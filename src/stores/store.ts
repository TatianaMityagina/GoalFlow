import { computed, reactive, ref, watch, type ComputedRef } from 'vue'
import type {
  Database,
  Goal,
  ID,
  ISODate,
  Priority,
  Project,
  SavedView,
  Settings,
  Task,
  TaskStatus,
  TimeEntry,
  Toast,
  ViewMode
} from '@/types'
import { loadDatabase, normalizeDatabase, saveDatabase } from '@/lib/storage'
import { effectiveGoalIds, filterTasks, type QueryContext } from '@/lib/query'
import {
  colorFromSeed,
  deepClone,
  formatMinutes,
  nowISO,
  startOfWeek,
  todayISO,
  toISODate,
  uid,
  unique
} from '@/lib/utils'

// Один экземпляр на модуль, а не фабрика: все компоненты импортируют тот же
// реактивный объект и работают с общим состоянием.

const db = reactive<Database>(loadDatabase())

// Общий тик раз в секунду вместо интервала в каждом компоненте с таймером.
const now = ref<number>(Date.now())
window.setInterval(() => {
  now.value = Date.now()
}, 1000)

/* Сохранение */

let saveHandle: number | null = null
const persistFailed = ref<boolean>(false)

function persist(): void {
  if (saveHandle !== null) window.clearTimeout(saveHandle)
  saveHandle = window.setTimeout(() => {
    const ok = saveDatabase(db)
    if (!ok && !persistFailed.value) {
      persistFailed.value = true
      pushToast('Не удалось сохранить в локальное хранилище — возможно, кончилось место.', 'error')
    }
    if (ok) persistFailed.value = false
  }, 200)
}

watch(db, persist, { deep: true })

// Другая вкладка изменила данные — перечитываем, чтобы состояния совпадали.
window.addEventListener('storage', (event: StorageEvent) => {
  if (event.key !== 'goalflow.db.v1' || event.newValue === null) return
  try {
    replaceDatabase(normalizeDatabase(JSON.parse(event.newValue) as unknown), false)
  } catch {
    // Испорченная запись извне игнорируется.
  }
})

function replaceDatabase(next: Database, notify: boolean): void {
  db.version = next.version
  db.goals = next.goals
  db.projects = next.projects
  db.tasks = next.tasks
  db.timeEntries = next.timeEntries
  db.savedViews = next.savedViews
  db.settings = next.settings
  if (notify) persist()
}

/* Уведомления */

const toasts = ref<Toast[]>([])

export function pushToast(
  message: string,
  kind: Toast['kind'] = 'info',
  action?: { label: string; run: () => void }
): void {
  const toast: Toast = { id: uid(), message, kind }
  if (action) {
    toast.actionLabel = action.label
    toast.action = action.run
  }
  toasts.value = [...toasts.value, toast]
  window.setTimeout(() => dismissToast(toast.id), action ? 8000 : 4000)
}

export function dismissToast(id: ID): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

/* Выбор и режим отображения */

const selectedGoalId = ref<ID | null>(null)
const selectedProjectId = ref<ID | null>(null)
const openTaskId = ref<ID | null>(null)
const searchQuery = ref<string>('')
const viewMode = ref<ViewMode>('list')
const activeViewId = ref<ID | null>(null)
const showCompleted = ref<boolean>(false)

/* Поиск сущностей */

function goalById(id: ID | null): Goal | null {
  return id === null ? null : db.goals.find((goal) => goal.id === id) ?? null
}

function projectById(id: ID | null): Project | null {
  return id === null ? null : db.projects.find((project) => project.id === id) ?? null
}

function taskById(id: ID | null): Task | null {
  return id === null ? null : db.tasks.find((task) => task.id === id) ?? null
}

/* Учёт времени */

const runningEntry: ComputedRef<TimeEntry | null> = computed(
  () => db.timeEntries.find((entry) => entry.endedAt === null) ?? null
)

const runningTask: ComputedRef<Task | null> = computed(() => taskById(runningEntry.value?.taskId ?? null))

/** Секунды на идущем таймере, `0` если таймер не запущен. */
const runningSeconds: ComputedRef<number> = computed(() => {
  const entry = runningEntry.value
  if (entry === null) return 0
  return Math.max(0, Math.floor((now.value - Date.parse(entry.startedAt)) / 1000))
})

function entryMinutes(entry: TimeEntry, reference: number): number {
  const end = entry.endedAt === null ? reference : Date.parse(entry.endedAt)
  return Math.max(0, (end - Date.parse(entry.startedAt)) / 60_000)
}

/** taskId → учтённые минуты. */
const spentByTask: ComputedRef<Map<ID, number>> = computed(() => {
  const totals = new Map<ID, number>()
  const reference = now.value
  for (const entry of db.timeEntries) {
    totals.set(entry.taskId, (totals.get(entry.taskId) ?? 0) + entryMinutes(entry, reference))
  }
  return totals
})

function spentMinutes(taskId: ID): number {
  return Math.round(spentByTask.value.get(taskId) ?? 0)
}

/** Таймер идёт дольше порога из настроек. */
const forgottenTimer: ComputedRef<{ entry: TimeEntry; minutes: number } | null> = computed(() => {
  const entry = runningEntry.value
  if (entry === null) return null
  const minutes = Math.floor(runningSeconds.value / 60)
  return minutes >= db.settings.idleThresholdMinutes ? { entry, minutes } : null
})

const dismissedForgottenAt = ref<number>(0)

const showForgottenPrompt: ComputedRef<boolean> = computed(() => {
  if (forgottenTimer.value === null) return false
  return now.value - dismissedForgottenAt.value > 10 * 60_000
})

/* Иерархия и прогресс */

function tasksOfProject(projectId: ID): Task[] {
  return db.tasks.filter((task) => task.projectIds.includes(projectId))
}

function tasksOfGoal(goalId: ID): Task[] {
  return db.tasks.filter((task) => effectiveGoalIds(task, db.projects).includes(goalId))
}

function projectsOfGoal(goalId: ID): Project[] {
  return db.projects.filter((project) => project.goalIds.includes(goalId))
}

export interface Progress {
  total: number
  done: number
  /** 0–100; `0`, когда задач нет. */
  percent: number
  spentMinutes: number
  estimateMinutes: number
}

function progressOf(tasks: Task[]): Progress {
  const total = tasks.length
  const done = tasks.filter((task) => task.status === 'done').length
  const spent = tasks.reduce((sum, task) => sum + spentMinutes(task.id), 0)
  const estimate = tasks.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0)
  return {
    total,
    done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    spentMinutes: spent,
    estimateMinutes: estimate
  }
}

const goalProgress = computed<Map<ID, Progress>>(() => {
  const map = new Map<ID, Progress>()
  for (const goal of db.goals) map.set(goal.id, progressOf(tasksOfGoal(goal.id)))
  return map
})

/* Фильтрация */

const queryContext: ComputedRef<QueryContext> = computed(() => ({
  goals: db.goals,
  projects: db.projects,
  spentMinutes,
  runningTaskId: runningEntry.value?.taskId ?? null
}))

/** Запрос из выбора в сайдбаре и строки поиска. */
const effectiveQuery: ComputedRef<string> = computed(() => {
  const parts: string[] = []
  if (selectedProjectId.value !== null) parts.push(`project:${selectedProjectId.value}`)
  else if (selectedGoalId.value !== null) parts.push(`goal:${selectedGoalId.value}`)
  if (searchQuery.value.trim() !== '') parts.push(searchQuery.value.trim())
  return parts.join(' ')
})

const visibleTasks: ComputedRef<Task[]> = computed(() => {
  let result = filterTasks(db.tasks, effectiveQuery.value, queryContext.value)
  // На доске нужна колонка «Готово»; список и календарь скрывают завершённые,
  // если это не запрошено явно и статус не указан в запросе.
  const mentionsStatus = /(^|\s)-?(status|статус|ст):/.test(effectiveQuery.value)
  if (!showCompleted.value && !mentionsStatus && viewMode.value !== 'board') {
    result = result.filter((task) => task.status !== 'done')
  }
  return [...result].sort(compareTasks)
})

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 }

function compareTasks(a: Task, b: Task): number {
  if (a.status === 'done' && b.status !== 'done') return 1
  if (b.status === 'done' && a.status !== 'done') return -1
  if (a.order !== b.order) return a.order - b.order
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }
  if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  return a.createdAt < b.createdAt ? 1 : -1
}

const allTags: ComputedRef<string[]> = computed(() =>
  unique(db.tasks.flatMap((task) => task.tags)).sort()
)

/* Изменение данных */

function nextOrder(): number {
  return db.tasks.reduce((max, task) => Math.max(max, task.order), 0) + 1
}

function touch(entity: { updatedAt: string }): void {
  entity.updatedAt = nowISO()
}

function createGoal(title: string, note = ''): Goal {
  const id = uid()
  const goal: Goal = {
    id,
    title: title.trim() === '' ? 'Цель без названия' : title.trim(),
    note,
    color: colorFromSeed(id),
    targetDate: null,
    archived: false,
    createdAt: nowISO(),
    updatedAt: nowISO()
  }
  db.goals.push(goal)
  return goal
}

function updateGoal(id: ID, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>): void {
  const goal = goalById(id)
  if (goal === null) return
  Object.assign(goal, patch)
  touch(goal)
}

function deleteGoal(id: ID): void {
  const goal = goalById(id)
  if (goal === null) return
  const snapshot = deepClone({
    goal,
    projects: db.projects.filter((project) => project.goalIds.includes(id)),
    tasks: db.tasks.filter((task) => task.goalIds.includes(id))
  })

  db.goals = db.goals.filter((candidate) => candidate.id !== id)
  // Проекты и задачи остаются, теряя только связь с этой целью.
  db.projects.forEach((project) => {
    project.goalIds = project.goalIds.filter((goalId) => goalId !== id)
  })
  db.tasks.forEach((task) => {
    task.goalIds = task.goalIds.filter((goalId) => goalId !== id)
  })
  if (selectedGoalId.value === id) selectedGoalId.value = null

  pushToast(`Цель «${goal.title}» удалена`, 'info', {
    label: 'Отменить',
    run: () => {
      db.goals.push(snapshot.goal)
      snapshot.projects.forEach((project) => {
        const live = projectById(project.id)
        if (live) live.goalIds = unique([...live.goalIds, id])
      })
      snapshot.tasks.forEach((task) => {
        const live = taskById(task.id)
        if (live) live.goalIds = unique([...live.goalIds, id])
      })
    }
  })
}

function createProject(title: string, goalIds: ID[] = [], note = ''): Project {
  const id = uid()
  const project: Project = {
    id,
    title: title.trim() === '' ? 'Проект без названия' : title.trim(),
    note,
    color: colorFromSeed(id),
    goalIds: [...goalIds],
    archived: false,
    createdAt: nowISO(),
    updatedAt: nowISO()
  }
  db.projects.push(project)
  return project
}

function updateProject(id: ID, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): void {
  const project = projectById(id)
  if (project === null) return
  Object.assign(project, patch)
  touch(project)
}

function deleteProject(id: ID): void {
  const project = projectById(id)
  if (project === null) return
  const affected = db.tasks.filter((task) => task.projectIds.includes(id)).map((task) => task.id)
  const snapshot = deepClone(project)

  db.projects = db.projects.filter((candidate) => candidate.id !== id)
  db.tasks.forEach((task) => {
    task.projectIds = task.projectIds.filter((projectId) => projectId !== id)
  })
  if (selectedProjectId.value === id) selectedProjectId.value = null

  pushToast(`Проект «${project.title}» удалён`, 'info', {
    label: 'Отменить',
    run: () => {
      db.projects.push(snapshot)
      affected.forEach((taskId) => {
        const task = taskById(taskId)
        if (task) task.projectIds = unique([...task.projectIds, id])
      })
    }
  })
}

export interface NewTaskInput {
  title: string
  note?: string
  projectIds?: ID[]
  goalIds?: ID[]
  tags?: string[]
  dueDate?: ISODate | null
  priority?: Priority
  estimateMinutes?: number | null
  status?: TaskStatus
}

function createTask(input: NewTaskInput): Task {
  const task: Task = {
    id: uid(),
    title: input.title.trim() === '' ? 'Задача без названия' : input.title.trim(),
    note: input.note ?? '',
    status: input.status ?? 'todo',
    priority: input.priority ?? 'none',
    projectIds: input.projectIds ?? [],
    goalIds: input.goalIds ?? [],
    tags: unique((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
    dueDate: input.dueDate ?? null,
    estimateMinutes: input.estimateMinutes ?? null,
    order: nextOrder(),
    completedAt: null,
    createdAt: nowISO(),
    updatedAt: nowISO()
  }
  db.tasks.push(task)
  return task
}

function updateTask(id: ID, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): void {
  const task = taskById(id)
  if (task === null) return
  if (patch.status !== undefined && patch.status !== task.status) {
    patch.completedAt = patch.status === 'done' ? nowISO() : null
    // Завершение задачи останавливает её таймер.
    if (patch.status === 'done' && runningEntry.value?.taskId === id) stopTimer()
  }
  if (patch.tags !== undefined) {
    patch.tags = unique(patch.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))
  }
  Object.assign(task, patch)
  touch(task)
}

function toggleTaskDone(id: ID): void {
  const task = taskById(id)
  if (task === null) return
  updateTask(id, { status: task.status === 'done' ? 'todo' : 'done' })
}

function deleteTask(id: ID): void {
  const task = taskById(id)
  if (task === null) return
  const taskSnapshot = deepClone(task)
  const entrySnapshots = deepClone(db.timeEntries.filter((entry) => entry.taskId === id))

  db.tasks = db.tasks.filter((candidate) => candidate.id !== id)
  db.timeEntries = db.timeEntries.filter((entry) => entry.taskId !== id)
  if (openTaskId.value === id) openTaskId.value = null

  pushToast(`Задача «${task.title}» удалена`, 'info', {
    label: 'Отменить',
    run: () => {
      db.tasks.push(taskSnapshot)
      db.timeEntries.push(...entrySnapshots)
    }
  })
}

/** Переставляет задачу перед `beforeTaskId`; `null` — в конец. */
function reorderTask(id: ID, beforeTaskId: ID | null): void {
  const task = taskById(id)
  if (task === null) return
  if (beforeTaskId === null) {
    task.order = nextOrder()
  } else {
    const target = taskById(beforeTaskId)
    if (target === null || target.id === id) return
    const ordered = [...db.tasks].sort((a, b) => a.order - b.order)
    const withoutTask = ordered.filter((candidate) => candidate.id !== id)
    const insertAt = withoutTask.findIndex((candidate) => candidate.id === beforeTaskId)
    withoutTask.splice(insertAt === -1 ? withoutTask.length : insertAt, 0, task)
    withoutTask.forEach((candidate, index) => {
      candidate.order = index + 1
    })
  }
  touch(task)
}

/* Таймер */

/** Запускает таймер, остановив предыдущий: одновременно идёт только один. */
function startTimer(taskId: ID, note = ''): void {
  const task = taskById(taskId)
  if (task === null) return
  const current = runningEntry.value
  if (current !== null) {
    if (current.taskId === taskId) return
    stopTimer()
  }
  db.timeEntries.push({
    id: uid(),
    taskId,
    startedAt: nowISO(),
    endedAt: null,
    note,
    source: 'timer'
  })
  if (task.status === 'todo') updateTask(taskId, { status: 'doing' })
  dismissedForgottenAt.value = 0
}

/** Сессии короче минуты отбрасываются, а не сохраняются нулевой записью. */
function stopTimer(): void {
  const entry = runningEntry.value
  if (entry === null) return
  const minutes = entryMinutes(entry, Date.now())
  if (minutes < 1) {
    db.timeEntries = db.timeEntries.filter((candidate) => candidate.id !== entry.id)
    return
  }
  entry.endedAt = nowISO()
}

function toggleTimer(taskId: ID): void {
  if (runningEntry.value?.taskId === taskId) stopTimer()
  else startTimer(taskId)
}

/** Завершает забытую сессию заданной длительностью; `0` — удалить. */
function trimRunningTimer(minutes: number): void {
  const entry = runningEntry.value
  if (entry === null) return
  if (minutes <= 0) {
    db.timeEntries = db.timeEntries.filter((candidate) => candidate.id !== entry.id)
    pushToast('Забытая сессия отброшена', 'info')
    return
  }
  entry.endedAt = new Date(Date.parse(entry.startedAt) + minutes * 60_000).toISOString()
  pushToast(`Сессия записана как ${formatMinutes(minutes)}`, 'success')
}

function dismissForgottenPrompt(): void {
  dismissedForgottenAt.value = Date.now()
}

function addManualEntry(taskId: ID, minutes: number, note = '', day: ISODate = todayISO()): void {
  if (minutes <= 0) return
  // Привязка к 12:00 по местному времени, чтобы запись попала в нужный день.
  const start = new Date(`${day}T12:00:00`)
  db.timeEntries.push({
    id: uid(),
    taskId,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    note,
    source: 'manual'
  })
}

function deleteTimeEntry(id: ID): void {
  db.timeEntries = db.timeEntries.filter((entry) => entry.id !== id)
}

function entriesOfTask(taskId: ID): TimeEntry[] {
  return db.timeEntries
    .filter((entry) => entry.taskId === taskId)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
}

/* Статистика */

export interface DayTotal {
  day: ISODate
  minutes: number
}

export interface Breakdown {
  id: ID
  label: string
  color: string
  minutes: number
}

/** Учтённые минуты по дням, от старых к новым. */
function dailyTotals(days: number): DayTotal[] {
  const totals = new Map<ISODate, number>()
  const reference = now.value
  for (const entry of db.timeEntries) {
    const day = toISODate(new Date(entry.startedAt))
    totals.set(day, (totals.get(day) ?? 0) + entryMinutes(entry, reference))
  }
  const result: DayTotal[] = []
  const cursor = new Date()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(cursor)
    date.setDate(date.getDate() - offset)
    const day = toISODate(date)
    result.push({ day, minutes: Math.round(totals.get(day) ?? 0) })
  }
  return result
}

function minutesInRange(from: Date, to: Date): number {
  const reference = now.value
  return Math.round(
    db.timeEntries
      .filter((entry) => {
        const started = Date.parse(entry.startedAt)
        return started >= from.getTime() && started < to.getTime()
      })
      .reduce((sum, entry) => sum + entryMinutes(entry, reference), 0)
  )
}

const todayMinutes = computed<number>(() => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return minutesInRange(start, end)
})

const weekMinutes = computed<number>(() => {
  const start = startOfWeek(new Date())
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return minutesInRange(start, end)
})

/** Распределение времени по целям, от большего к меньшему. */
const minutesByGoal = computed<Breakdown[]>(() => {
  const totals = new Map<ID, number>()
  let unassigned = 0
  for (const task of db.tasks) {
    const minutes = spentMinutes(task.id)
    if (minutes === 0) continue
    const goalIds = effectiveGoalIds(task, db.projects)
    if (goalIds.length === 0) {
      unassigned += minutes
      continue
    }
    // Время задачи с несколькими целями делится между ними поровну.
    const share = minutes / goalIds.length
    goalIds.forEach((goalId) => totals.set(goalId, (totals.get(goalId) ?? 0) + share))
  }
  const rows: Breakdown[] = db.goals
    .filter((goal) => (totals.get(goal.id) ?? 0) > 0)
    .map((goal) => ({
      id: goal.id,
      label: goal.title,
      color: goal.color,
      minutes: Math.round(totals.get(goal.id) ?? 0)
    }))
  if (unassigned > 0) {
    rows.push({ id: 'none', label: 'Без цели', color: 'var(--text-faint)', minutes: Math.round(unassigned) })
  }
  return rows.sort((a, b) => b.minutes - a.minutes)
})

const minutesByProject = computed<Breakdown[]>(() => {
  const totals = new Map<ID, number>()
  let unassigned = 0
  for (const task of db.tasks) {
    const minutes = spentMinutes(task.id)
    if (minutes === 0) continue
    if (task.projectIds.length === 0) {
      unassigned += minutes
      continue
    }
    const share = minutes / task.projectIds.length
    task.projectIds.forEach((projectId) => totals.set(projectId, (totals.get(projectId) ?? 0) + share))
  }
  const rows: Breakdown[] = db.projects
    .filter((project) => (totals.get(project.id) ?? 0) > 0)
    .map((project) => ({
      id: project.id,
      label: project.title,
      color: project.color,
      minutes: Math.round(totals.get(project.id) ?? 0)
    }))
  if (unassigned > 0) {
    rows.push({ id: 'none', label: 'Вне проекта', color: 'var(--text-faint)', minutes: Math.round(unassigned) })
  }
  return rows.sort((a, b) => b.minutes - a.minutes)
})

/* Сохранённые виды */

function applyView(view: SavedView): void {
  searchQuery.value = view.query
  viewMode.value = view.mode
  activeViewId.value = view.id
  selectedGoalId.value = null
  selectedProjectId.value = null
}

function saveCurrentView(name: string): void {
  const view: SavedView = {
    id: uid(),
    name: name.trim() === '' ? 'Мой вид' : name.trim(),
    query: searchQuery.value,
    mode: viewMode.value,
    builtin: false
  }
  db.savedViews.push(view)
  activeViewId.value = view.id
  pushToast(`Вид «${view.name}» сохранён`, 'success')
}

function deleteView(id: ID): void {
  const view = db.savedViews.find((candidate) => candidate.id === id)
  if (view === undefined || view.builtin) return
  db.savedViews = db.savedViews.filter((candidate) => candidate.id !== id)
  if (activeViewId.value === id) activeViewId.value = null
}

function clearFilters(): void {
  searchQuery.value = ''
  activeViewId.value = null
  selectedGoalId.value = null
  selectedProjectId.value = null
}

/* Импорт и экспорт */

function exportJSON(): string {
  const payload: Database = {
    ...deepClone(db),
    // Ключ API не попадает в файл бэкапа.
    settings: { ...deepClone(db.settings), aiApiKey: '' }
  }
  return JSON.stringify(payload, null, 2)
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function exportTasksCSV(): string {
  const header = [
    'id',
    'title',
    'status',
    'priority',
    'goals',
    'projects',
    'tags',
    'due',
    'estimate_minutes',
    'spent_minutes',
    'created',
    'completed'
  ]
  const rows = db.tasks.map((task) => {
    const goals = effectiveGoalIds(task, db.projects)
      .map((id) => goalById(id)?.title ?? '')
      .filter(Boolean)
      .join('; ')
    const projects = task.projectIds
      .map((id) => projectById(id)?.title ?? '')
      .filter(Boolean)
      .join('; ')
    return [
      task.id,
      task.title,
      task.status,
      task.priority,
      goals,
      projects,
      task.tags.join('; '),
      task.dueDate ?? '',
      task.estimateMinutes === null ? '' : String(task.estimateMinutes),
      String(spentMinutes(task.id)),
      task.createdAt,
      task.completedAt ?? ''
    ].map(csvCell)
  })
  return [header.map(csvCell).join(','), ...rows.map((row) => row.join(','))].join('\n')
}

function exportTimeCSV(): string {
  const header = ['entry_id', 'task', 'started_at', 'ended_at', 'minutes', 'source', 'note']
  const reference = now.value
  const rows = db.timeEntries.map((entry) =>
    [
      entry.id,
      taskById(entry.taskId)?.title ?? '(deleted task)',
      entry.startedAt,
      entry.endedAt ?? '',
      String(Math.round(entryMinutes(entry, reference))),
      entry.source,
      entry.note
    ].map(csvCell)
  )
  return [header.map(csvCell).join(','), ...rows.map((row) => row.join(','))].join('\n')
}

export type ImportMode = 'replace' | 'merge'

function importJSON(raw: string, mode: ImportMode): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    pushToast('Это не корректный JSON', 'error')
    return false
  }

  const incoming = normalizeDatabase(parsed)
  if (incoming.goals.length === 0 && incoming.projects.length === 0 && incoming.tasks.length === 0) {
    pushToast('Импортировать нечего — в файле нет целей, проектов и задач', 'warning')
    return false
  }

  if (mode === 'replace') {
    const key = db.settings.aiApiKey
    replaceDatabase(incoming, true)
    // В бэкапе ключа нет, поэтому сохраняется имеющийся на устройстве.
    db.settings.aiApiKey = key
    pushToast(`Импортировано задач: ${incoming.tasks.length}. Прежние данные заменены.`, 'success')
    return true
  }

  // При слиянии существующие id не трогаются, остальное добавляется.
  const existingGoals = new Set(db.goals.map((goal) => goal.id))
  const existingProjects = new Set(db.projects.map((project) => project.id))
  const existingTasks = new Set(db.tasks.map((task) => task.id))
  const existingEntries = new Set(db.timeEntries.map((entry) => entry.id))

  const addedGoals = incoming.goals.filter((goal) => !existingGoals.has(goal.id))
  const addedProjects = incoming.projects.filter((project) => !existingProjects.has(project.id))
  const addedTasks = incoming.tasks.filter((task) => !existingTasks.has(task.id))
  const addedEntries = incoming.timeEntries.filter((entry) => !existingEntries.has(entry.id))

  db.goals.push(...addedGoals)
  db.projects.push(...addedProjects)
  db.tasks.push(...addedTasks)
  db.timeEntries.push(...addedEntries)
  // Открытая запись, пришедшая при слиянии, закрывается: таймер может быть один.
  const running = db.timeEntries.filter((entry) => entry.endedAt === null)
  running.slice(1).forEach((entry) => {
    entry.endedAt = nowISO()
  })

  pushToast(
    `Добавлено: задач — ${addedTasks.length}, проектов — ${addedProjects.length}, целей — ${addedGoals.length}`,
    'success'
  )
  return true
}

function resetAll(): void {
  const snapshot = deepClone(db)
  db.goals = []
  db.projects = []
  db.tasks = []
  db.timeEntries = []
  clearFilters()
  pushToast('Все данные удалены', 'warning', {
    label: 'Отменить',
    run: () => replaceDatabase(snapshot, true)
  })
}

/* Настройки */

function updateSettings(patch: Partial<Settings>): void {
  Object.assign(db.settings, patch)
}

/* Пример данных */

/** Заполняет пространство примером для первого знакомства. */
function loadSampleData(): void {
  const goal = createGoal('Запустить GoalFlow v1 до марта', 'Сделать то, чем люди будут пользоваться постоянно.')
  goal.targetDate = toISODate(new Date(new Date().getFullYear(), 2, 1))
  const learning = createGoal('Как следует разобраться в TypeScript')

  const landing = createProject('MVP лендинга', [goal.id])
  const app = createProject('Ядро приложения', [goal.id])
  const study = createProject('Практика по типам', [learning.id])

  const today = todayISO()
  const soon = toISODate(new Date(Date.now() + 3 * 86_400_000))
  const past = toISODate(new Date(Date.now() - 2 * 86_400_000))

  const seeded: NewTaskInput[] = [
    { title: 'Написать текст для первого экрана', projectIds: [landing.id], priority: 'high', dueDate: today, estimateMinutes: 90, tags: ['текст'] },
    { title: 'Подобрать пару шрифтов', projectIds: [landing.id], priority: 'low', tags: ['дизайн'], estimateMinutes: 45 },
    { title: 'Сверстать таблицу тарифов', projectIds: [landing.id], dueDate: soon, estimateMinutes: 120, status: 'doing' },
    { title: 'Продумать модель учёта времени', projectIds: [app.id], priority: 'high', status: 'done', estimateMinutes: 180 },
    { title: 'Сделать парсер строки фильтров', projectIds: [app.id], priority: 'medium', status: 'doing', estimateMinutes: 150, tags: ['фокус'] },
    { title: 'Пройтись по горячим клавишам', projectIds: [app.id], dueDate: past, priority: 'medium', estimateMinutes: 60 },
    { title: 'Прочитать главу про условные типы', projectIds: [study.id], tags: ['учёба'], estimateMinutes: 60 },
    { title: 'Позвонить бухгалтеру', priority: 'medium', dueDate: today, tags: ['бумаги'] },
    { title: 'Подумать, каким должен быть v2', goalIds: [goal.id], tags: ['обдумать'] }
  ]
  const created = seeded.map((input) => createTask(input))

  // Несколько сессий за прошедшую неделю: [индекс задачи, дней назад, минут].
  const sessions: Array<[number, number, number]> = [
    [0, 0, 85],
    [2, 1, 140],
    [3, 2, 195],
    [4, 1, 260],
    [4, 3, 120],
    [5, 4, 55],
    [6, 0, 40],
    [7, 2, 65]
  ]
  for (const [taskIndex, daysAgo, minutes] of sessions) {
    const task = created[taskIndex]
    if (task === undefined) continue
    addManualEntry(task.id, minutes, 'Пример сессии', toISODate(new Date(Date.now() - daysAgo * 86_400_000)))
  }

  selectedGoalId.value = goal.id
  pushToast('Пример рабочего пространства загружен', 'success')
}

/* Публичный интерфейс стора */

export const store = {
  // состояние
  db,
  toasts,
  now,
  selectedGoalId,
  selectedProjectId,
  openTaskId,
  searchQuery,
  viewMode,
  activeViewId,
  showCompleted,

  // производные данные
  visibleTasks,
  effectiveQuery,
  allTags,
  goalProgress,
  runningEntry,
  runningTask,
  runningSeconds,
  forgottenTimer,
  showForgottenPrompt,
  todayMinutes,
  weekMinutes,
  minutesByGoal,
  minutesByProject,
  queryContext,

  // поиск сущностей
  goalById,
  projectById,
  taskById,
  tasksOfGoal,
  tasksOfProject,
  projectsOfGoal,
  entriesOfTask,
  spentMinutes,
  dailyTotals,
  progressOf,

  // изменения
  createGoal,
  updateGoal,
  deleteGoal,
  createProject,
  updateProject,
  deleteProject,
  createTask,
  updateTask,
  toggleTaskDone,
  deleteTask,
  reorderTask,

  // время
  startTimer,
  stopTimer,
  toggleTimer,
  trimRunningTimer,
  dismissForgottenPrompt,
  addManualEntry,
  deleteTimeEntry,

  // виды
  applyView,
  saveCurrentView,
  deleteView,
  clearFilters,

  // данные
  exportJSON,
  exportTasksCSV,
  exportTimeCSV,
  importJSON,
  resetAll,
  loadSampleData,
  updateSettings,

  // обратная связь
  pushToast,
  dismissToast
}

export type Store = typeof store

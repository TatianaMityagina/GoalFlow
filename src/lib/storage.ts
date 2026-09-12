import type {
  Database,
  Goal,
  Priority,
  Project,
  SavedView,
  Settings,
  Task,
  TaskStatus,
  TimeEntry,
  ViewMode
} from '@/types'
import { nowISO, uid } from './utils'

export const STORAGE_KEY = 'goalflow.db.v1'
const SCHEMA_VERSION = 1

// Данные из localStorage и импорта считаются недоверенными: бэкап могли
// отредактировать руками, прошлая версия — записать другую структуру.
// Каждое поле проверяется по типу, неизвестное значение заменяется
// умолчанием, чтобы не терять файл целиком.

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: JsonValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function bool(value: JsonValue | undefined, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function num(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNum(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullableStr(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function strArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function objArray(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject)
}

function oneOf<T extends string>(value: JsonValue | undefined, allowed: readonly T[], fallback: T): T {
  const candidate = typeof value === 'string' ? value : ''
  return (allowed as readonly string[]).includes(candidate) ? (candidate as T) : fallback
}

const STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done']
const PRIORITIES: readonly Priority[] = ['none', 'low', 'medium', 'high']
const VIEW_MODES: readonly ViewMode[] = ['list', 'board', 'calendar']

/** Принимает ISO-строки и старые сериализованные `Date`. */
function timestamp(value: JsonValue | undefined, fallback: string): string {
  if (typeof value !== 'string' || value === '') return fallback
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString()
}

/** Приводит срок к `ГГГГ-ММ-ДД`, если он сохранён как метка времени. */
function dueDate(value: JsonValue | undefined): string | null {
  const raw = nullableStr(value)
  if (raw === null) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : raw.slice(0, 10)
}

function parseGoal(raw: JsonObject): Goal {
  const created = timestamp(raw.createdAt, nowISO())
  return {
    id: str(raw.id) || uid(),
    title: str(raw.title, 'Цель без названия'),
    note: str(raw.note),
    color: str(raw.color, 'hsl(222 68% 52%)'),
    targetDate: dueDate(raw.targetDate),
    archived: bool(raw.archived),
    createdAt: created,
    updatedAt: timestamp(raw.updatedAt, created)
  }
}

function parseProject(raw: JsonObject): Project {
  const created = timestamp(raw.createdAt, nowISO())
  // В старой структуре было одиночное поле `goalId`.
  const legacyGoal = nullableStr(raw.goalId)
  const goalIds = strArray(raw.goalIds)
  return {
    id: str(raw.id) || uid(),
    title: str(raw.title, 'Проект без названия'),
    note: str(raw.note),
    color: str(raw.color, 'hsl(262 68% 52%)'),
    goalIds: goalIds.length > 0 ? goalIds : legacyGoal ? [legacyGoal] : [],
    archived: bool(raw.archived),
    createdAt: created,
    updatedAt: timestamp(raw.updatedAt, created)
  }
}

function parseTask(raw: JsonObject, index: number): Task {
  const created = timestamp(raw.createdAt, nowISO())
  const legacyProject = nullableStr(raw.projectId)
  const legacyGoal = nullableStr(raw.goalId)
  const projectIds = strArray(raw.projectIds)
  const goalIds = strArray(raw.goalIds)
  const status = oneOf(raw.status, STATUSES, 'todo')
  return {
    id: str(raw.id) || uid(),
    title: str(raw.title, 'Задача без названия'),
    note: str(raw.note),
    status,
    priority: oneOf(raw.priority, PRIORITIES, 'none'),
    projectIds: projectIds.length > 0 ? projectIds : legacyProject ? [legacyProject] : [],
    goalIds: goalIds.length > 0 ? goalIds : legacyGoal ? [legacyGoal] : [],
    tags: strArray(raw.tags),
    dueDate: dueDate(raw.dueDate),
    estimateMinutes: nullableNum(raw.estimateMinutes),
    order: num(raw.order, index),
    completedAt: status === 'done' ? timestamp(raw.completedAt, created) : null,
    createdAt: created,
    updatedAt: timestamp(raw.updatedAt, created)
  }
}

function parseTimeEntry(raw: JsonObject): TimeEntry | null {
  const taskId = nullableStr(raw.taskId)
  if (taskId === null) return null
  return {
    id: str(raw.id) || uid(),
    taskId,
    startedAt: timestamp(raw.startedAt, nowISO()),
    endedAt: raw.endedAt === null || raw.endedAt === undefined ? null : timestamp(raw.endedAt, nowISO()),
    note: str(raw.note),
    source: oneOf(raw.source, ['timer', 'manual'] as const, 'timer')
  }
}

function parseSavedView(raw: JsonObject): SavedView {
  return {
    id: str(raw.id) || uid(),
    name: str(raw.name, 'Вид'),
    query: str(raw.query),
    mode: oneOf(raw.mode, VIEW_MODES, 'list'),
    builtin: bool(raw.builtin)
  }
}

function defaultSettings(): Settings {
  return {
    theme: 'system',
    idleThresholdMinutes: 90,
    aiEnabled: false,
    aiApiKey: '',
    aiModel: 'claude-sonnet-5',
    aiShareNotes: false
  }
}

function parseSettings(raw: JsonValue | undefined): Settings {
  const base = defaultSettings()
  if (!isObject(raw)) return base
  return {
    theme: oneOf(raw.theme, ['light', 'dark', 'system'] as const, base.theme),
    idleThresholdMinutes: Math.max(5, num(raw.idleThresholdMinutes, base.idleThresholdMinutes)),
    aiEnabled: bool(raw.aiEnabled, base.aiEnabled),
    aiApiKey: str(raw.aiApiKey, base.aiApiKey),
    aiModel: str(raw.aiModel, base.aiModel),
    aiShareNotes: bool(raw.aiShareNotes, base.aiShareNotes)
  }
}

// Id встроенных видов постоянные: по ним сохраняются пользовательские правки.
function builtinViews(): SavedView[] {
  return [
    { id: 'view-today', name: 'Сегодня', query: 'срок:сегодня -статус:готово', mode: 'list', builtin: true },
    { id: 'view-week', name: 'Эта неделя', query: 'срок:неделя -статус:готово', mode: 'list', builtin: true },
    { id: 'view-doing', name: 'В работе', query: 'статус:вработе', mode: 'board', builtin: true },
    { id: 'view-orphans', name: 'Без цели', query: 'цель:нет -статус:готово', mode: 'list', builtin: true },
    { id: 'view-stuck', name: 'Возможно застряли', query: 'время:>4ч -статус:готово', mode: 'list', builtin: true },
    { id: 'view-overdue', name: 'Просрочено', query: 'срок:просрочено', mode: 'list', builtin: true }
  ]
}

function emptyDatabase(): Database {
  return {
    version: SCHEMA_VERSION,
    goals: [],
    projects: [],
    tasks: [],
    timeEntries: [],
    savedViews: builtinViews(),
    settings: defaultSettings()
  }
}

/** Приводит произвольный JSON к корректной `Database`. */
export function normalizeDatabase(input: unknown): Database {
  const db = emptyDatabase()

  // Старый формат экспорта: массив целей с вложенными проектами и задачами.
  if (Array.isArray(input)) {
    for (const rawGoal of input.filter(isObject)) {
      const goal = parseGoal(rawGoal)
      db.goals.push(goal)
      objArray(rawGoal.projects).forEach((rawProject) => {
        const project = parseProject(rawProject)
        if (project.goalIds.length === 0) project.goalIds = [goal.id]
        db.projects.push(project)
        objArray(rawProject.tasks).forEach((rawTask, index) => {
          const task = parseTask(rawTask, index)
          if (task.projectIds.length === 0) task.projectIds = [project.id]
          db.tasks.push(task)
        })
      })
    }
    return reconcile(db)
  }

  if (!isObject(input)) return db

  db.goals = objArray(input.goals).map(parseGoal)
  db.projects = objArray(input.projects).map(parseProject)
  db.tasks = objArray(input.tasks).map(parseTask)
  db.timeEntries = objArray(input.timeEntries)
    .map(parseTimeEntry)
    .filter((entry): entry is TimeEntry => entry !== null)
  db.settings = parseSettings(input.settings)

  const storedViews = objArray(input.savedViews).map(parseSavedView)
  const customViews = storedViews.filter((view) => !view.builtin)
  const builtins = builtinViews().map((builtin) => {
    const stored = storedViews.find((view) => view.id === builtin.id)
    return stored ? { ...builtin, mode: stored.mode } : builtin
  })
  db.savedViews = [...builtins, ...customViews]

  return reconcile(db)
}

/** Убирает ссылки на удалённые сущности и упорядочивает записи. */
function reconcile(db: Database): Database {
  const goalIds = new Set(db.goals.map((goal) => goal.id))
  const projectIds = new Set(db.projects.map((project) => project.id))
  const taskIds = new Set(db.tasks.map((task) => task.id))

  db.projects.forEach((project) => {
    project.goalIds = project.goalIds.filter((id) => goalIds.has(id))
  })
  db.tasks.forEach((task) => {
    task.projectIds = task.projectIds.filter((id) => projectIds.has(id))
    task.goalIds = task.goalIds.filter((id) => goalIds.has(id))
    task.tags = Array.from(new Set(task.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))
  })
  db.timeEntries = db.timeEntries.filter((entry) => taskIds.has(entry.taskId))
  db.tasks.sort((a, b) => a.order - b.order)
  return db
}

export function loadDatabase(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return emptyDatabase()
    return normalizeDatabase(JSON.parse(raw) as unknown)
  } catch (error) {
    console.error('GoalFlow: не удалось прочитать локальные данные, начинаем с пустых.', error)
    return emptyDatabase()
  }
}

export function saveDatabase(db: Database): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
    return true
  } catch (error) {
    console.error('GoalFlow: не удалось сохранить локальные данные.', error)
    return false
  }
}

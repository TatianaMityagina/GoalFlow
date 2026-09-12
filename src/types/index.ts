// Все даты хранятся строками ISO-8601, а не объектами Date: JSON проходит
// через localStorage, экспорт и импорт без шага восстановления объектов.

export type ID = string
export type ISODateTime = string
/** Календарный день `ГГГГ-ММ-ДД` в поясе пользователя. */
export type ISODate = string

export type TaskStatus = 'todo' | 'doing' | 'done'
export type Priority = 'none' | 'low' | 'medium' | 'high'
export type ViewMode = 'list' | 'board' | 'calendar'
export type ThemePreference = 'light' | 'dark' | 'system'

export interface Goal {
  id: ID
  title: string
  note: string
  color: string
  targetDate: ISODate | null
  archived: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface Project {
  id: ID
  title: string
  note: string
  color: string
  /** Проект может служить нескольким целям; пустой массив — цели нет. */
  goalIds: ID[]
  archived: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface Task {
  id: ID
  title: string
  note: string
  status: TaskStatus
  priority: Priority
  /** Задача может входить в несколько проектов или ни в один. */
  projectIds: ID[]
  /** Цели, привязанные напрямую, помимо целей проектов задачи. */
  goalIds: ID[]
  tags: string[]
  dueDate: ISODate | null
  estimateMinutes: number | null
  /** Ручной порядок сортировки. */
  order: number
  completedAt: ISODateTime | null
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface TimeEntry {
  id: ID
  taskId: ID
  startedAt: ISODateTime
  /** `null`, пока таймер идёт. */
  endedAt: ISODateTime | null
  note: string
  /** `timer` — секундомер, `manual` — ввод задним числом. */
  source: 'timer' | 'manual'
}

export interface SavedView {
  id: ID
  name: string
  /** Запрос на языке фильтров, например `статус:вработе срок:неделя`. */
  query: string
  mode: ViewMode
  /** Встроенные виды не удаляются. */
  builtin: boolean
}

export interface Settings {
  theme: ThemePreference
  /** Через сколько минут работы таймера предупреждать о забытом таймере. */
  idleThresholdMinutes: number
  aiEnabled: boolean
  /** Ключ Anthropic; хранится только в localStorage, пусто — режим эвристик. */
  aiApiKey: string
  aiModel: string
  /** Если выключено, заметки задач в запросы не попадают. */
  aiShareNotes: boolean
}

export interface Database {
  version: number
  goals: Goal[]
  projects: Project[]
  tasks: Task[]
  timeEntries: TimeEntry[]
  savedViews: SavedView[]
  settings: Settings
}

export interface FilterClause {
  key: string
  value: string
  negated: boolean
}

export interface ParsedQuery {
  clauses: FilterClause[]
  /** Часть запроса без токенов — поиск по тексту. */
  text: string
}

export interface Toast {
  id: ID
  message: string
  kind: 'info' | 'success' | 'warning' | 'error'
  actionLabel?: string
  action?: () => void
}

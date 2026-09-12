import type { FilterClause, Goal, ParsedQuery, Project, Task } from '@/types'
import { daysUntil, fromISODate, fuzzyIncludes, startOfMonth, startOfWeek, todayISO } from './utils'

// Язык фильтров: `статус:вработе срок:неделя #тег -статус:готово текст`.
// Клаузы объединяются через И, повтор одного ключа — через ИЛИ, префикс `-`
// инвертирует. Русские и английские написания равнозначны.

export interface QueryContext {
  goals: Goal[]
  projects: Project[]
  /** Учтённые минуты, включая идущий таймер. */
  spentMinutes: (taskId: string) => number
  runningTaskId: string | null
}

// Русские и сокращённые написания сводятся к каноническим английским ключам.
const KEY_ALIASES: Record<string, string> = {
  s: 'status',
  статус: 'status',
  ст: 'status',
  p: 'priority',
  prio: 'priority',
  приоритет: 'priority',
  пр: 'priority',
  g: 'goal',
  цель: 'goal',
  ц: 'goal',
  proj: 'project',
  проект: 'project',
  t: 'tag',
  тег: 'tag',
  метка: 'tag',
  d: 'due',
  срок: 'due',
  дедлайн: 'due',
  time: 'spent',
  время: 'spent',
  потрачено: 'spent',
  estimate: 'est',
  оценка: 'est',
  есть: 'is',
  создана: 'created',
  создано: 'created'
}

// То же для значений: словарь на каждый ключ.
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  status: {
    сделать: 'todo',
    новая: 'todo',
    вработе: 'doing',
    'в работе': 'doing',
    делаю: 'doing',
    готово: 'done',
    сделано: 'done',
    открытые: 'open',
    активные: 'open'
  },
  priority: {
    высокий: 'high',
    высокая: 'high',
    средний: 'medium',
    средняя: 'medium',
    низкий: 'low',
    низкая: 'low',
    нет: 'none'
  },
  due: {
    сегодня: 'today',
    завтра: 'tomorrow',
    неделя: 'week',
    месяц: 'month',
    просрочено: 'overdue',
    нет: 'none',
    есть: 'any'
  },
  is: {
    идёт: 'running',
    идет: 'running',
    сучётом: 'tracked',
    безучёта: 'untracked',
    безвремени: 'untracked',
    соценкой: 'estimated',
    сверхоценки: 'overrun',
    безцели: 'orphan'
  },
  created: { сегодня: 'today', неделя: 'week', месяц: 'month' },
  goal: { нет: 'none', есть: 'any' },
  project: { нет: 'none', есть: 'any' },
  tag: { нет: 'none', есть: 'any' }
}

const QUERY_KEYS = [
  'status',
  'priority',
  'goal',
  'project',
  'tag',
  'due',
  'spent',
  'est',
  'is',
  'created'
] as const

// Делит по пробелам, сохраняя `ключ:"два слова"` целиком.
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (/\s/.test(char) && !quoted) {
      if (current !== '') tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current !== '') tokens.push(current)
  return tokens
}

function normalizeValue(key: string, value: string): string {
  return VALUE_ALIASES[key]?.[value] ?? value
}

export function parseQuery(input: string): ParsedQuery {
  const clauses: FilterClause[] = []
  const words: string[] = []

  for (const token of tokenize(input)) {
    const negated = token.startsWith('-')
    const body = negated ? token.slice(1) : token

    if (body.startsWith('#') && body.length > 1) {
      clauses.push({ key: 'tag', value: body.slice(1).toLowerCase(), negated })
      continue
    }

    const separator = body.indexOf(':')
    if (separator > 0) {
      const rawKey = body.slice(0, separator).toLowerCase()
      const key = KEY_ALIASES[rawKey] ?? rawKey
      const rawValue = body.slice(separator + 1).toLowerCase()
      if ((QUERY_KEYS as readonly string[]).includes(key) && rawValue !== '') {
        clauses.push({ key, value: normalizeValue(key, rawValue), negated })
        continue
      }
    }

    if (body !== '') words.push(body)
  }

  return { clauses, text: words.join(' ') }
}

/** `4ч` → 240, `1ч30м` → 90, `45` → 45. Понимает и `h`/`m`. */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/ч/g, 'h').replace(/м(ин)?/g, 'm')
  if (text === '') return null
  const compound = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+(?:[.,]\d+)?)m)?$/.exec(text)
  if (compound && (compound[1] !== undefined || compound[2] !== undefined)) {
    const toNumber = (value: string | undefined): number =>
      value === undefined ? 0 : Number(value.replace(',', '.'))
    return Math.round(toNumber(compound[1]) * 60 + toNumber(compound[2]))
  }
  const plain = Number(text.replace(',', '.'))
  return Number.isFinite(plain) ? Math.round(plain) : null
}

interface Comparison {
  op: '>' | '<' | '>=' | '<=' | '='
  minutes: number
}

function parseComparison(value: string): Comparison | null {
  const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(value.trim())
  if (!match) return null
  const minutes = parseDuration(match[2] ?? '')
  if (minutes === null) return null
  const op = (match[1] ?? '=') as Comparison['op']
  return { op, minutes }
}

function compare(actual: number, comparison: Comparison): boolean {
  switch (comparison.op) {
    case '>':
      return actual > comparison.minutes
    case '<':
      return actual < comparison.minutes
    case '>=':
      return actual >= comparison.minutes
    case '<=':
      return actual <= comparison.minutes
    case '=':
      return actual === comparison.minutes
  }
}

/** Ищет по id или по вхождению в название. */
function resolveByName<T extends { id: string; title: string }>(items: T[], value: string): string[] {
  const matches = items.filter((item) => item.id === value || fuzzyIncludes(item.title, value))
  return matches.map((item) => item.id)
}

/** Цели задачи: привязанные напрямую плюс цели её проектов. */
export function effectiveGoalIds(task: Task, projects: Project[]): string[] {
  const ids = new Set(task.goalIds)
  for (const projectId of task.projectIds) {
    const project = projects.find((candidate) => candidate.id === projectId)
    project?.goalIds.forEach((goalId) => ids.add(goalId))
  }
  return Array.from(ids)
}

function matchesDue(task: Task, value: string): boolean {
  if (value === 'none') return task.dueDate === null
  if (value === 'any') return task.dueDate !== null
  if (task.dueDate === null) return false

  const diff = daysUntil(task.dueDate)
  switch (value) {
    case 'today':
      return diff === 0
    case 'tomorrow':
      return diff === 1
    case 'overdue':
      return diff < 0
    case 'week': {
      const due = fromISODate(task.dueDate)
      const weekEnd = startOfWeek(new Date())
      weekEnd.setDate(weekEnd.getDate() + 7)
      return due < weekEnd && diff >= -365
    }
    case 'month': {
      const due = fromISODate(task.dueDate)
      const monthEnd = startOfMonth(new Date())
      monthEnd.setMonth(monthEnd.getMonth() + 1)
      return due < monthEnd
    }
    default:
      return task.dueDate === value
  }
}

function matchesCreated(task: Task, value: string): boolean {
  const created = new Date(task.createdAt)
  switch (value) {
    case 'today':
      return task.createdAt.slice(0, 10) === todayISO()
    case 'week':
      return created >= startOfWeek(new Date())
    case 'month':
      return created >= startOfMonth(new Date())
    default:
      return task.createdAt.slice(0, 10) === value
  }
}

function matchesIs(task: Task, value: string, context: QueryContext): boolean {
  const spent = context.spentMinutes(task.id)
  switch (value) {
    case 'running':
      return context.runningTaskId === task.id
    case 'tracked':
      return spent > 0
    case 'untracked':
      return spent === 0
    case 'estimated':
      return task.estimateMinutes !== null
    case 'overrun':
      return task.estimateMinutes !== null && spent > task.estimateMinutes
    case 'orphan':
      return effectiveGoalIds(task, context.projects).length === 0
    default:
      return false
  }
}

function matchesClause(task: Task, clause: FilterClause, context: QueryContext): boolean {
  const { key, value } = clause
  switch (key) {
    case 'status':
      if (value === 'open') return task.status !== 'done'
      return task.status === value
    case 'priority':
      return task.priority === value
    case 'tag':
      if (value === 'none') return task.tags.length === 0
      if (value === 'any') return task.tags.length > 0
      return task.tags.some((tag) => fuzzyIncludes(tag, value))
    case 'goal': {
      const goalIds = effectiveGoalIds(task, context.projects)
      if (value === 'none') return goalIds.length === 0
      if (value === 'any') return goalIds.length > 0
      const wanted = resolveByName(context.goals, value)
      return goalIds.some((id) => wanted.includes(id))
    }
    case 'project': {
      if (value === 'none') return task.projectIds.length === 0
      if (value === 'any') return task.projectIds.length > 0
      const wanted = resolveByName(context.projects, value)
      return task.projectIds.some((id) => wanted.includes(id))
    }
    case 'due':
      return matchesDue(task, value)
    case 'created':
      return matchesCreated(task, value)
    case 'is':
      return matchesIs(task, value, context)
    case 'spent': {
      const comparison = parseComparison(value)
      return comparison === null ? true : compare(context.spentMinutes(task.id), comparison)
    }
    case 'est': {
      const comparison = parseComparison(value)
      if (comparison === null || task.estimateMinutes === null) return false
      return compare(task.estimateMinutes, comparison)
    }
    default:
      return true
  }
}

function matchesText(task: Task, text: string): boolean {
  if (text === '') return true
  const haystack = `${task.title} ${task.note} ${task.tags.join(' ')}`
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => fuzzyIncludes(haystack, word))
}

export function filterTasks(tasks: Task[], query: string, context: QueryContext): Task[] {
  const parsed = parseQuery(query)
  if (parsed.clauses.length === 0 && parsed.text === '') return tasks

  // Группировка по ключу нужна, чтобы повтор ключа работал как ИЛИ.
  const positive = new Map<string, FilterClause[]>()
  const negative: FilterClause[] = []
  for (const clause of parsed.clauses) {
    if (clause.negated) {
      negative.push(clause)
      continue
    }
    const group = positive.get(clause.key) ?? []
    group.push(clause)
    positive.set(clause.key, group)
  }

  return tasks.filter((task) => {
    for (const group of positive.values()) {
      if (!group.some((clause) => matchesClause(task, clause, context))) return false
    }
    for (const clause of negative) {
      if (matchesClause(task, clause, context)) return false
    }
    return matchesText(task, parsed.text)
  })
}

export interface QuerySuggestion {
  insert: string
  hint: string
}

export function suggestQueryTokens(fragment: string): QuerySuggestion[] {
  const suggestions: QuerySuggestion[] = [
    { insert: 'статус:сделать', hint: 'Ещё не начата' },
    { insert: 'статус:вработе', hint: 'В работе' },
    { insert: 'статус:готово', hint: 'Завершена' },
    { insert: 'приоритет:высокий', hint: 'Высокий приоритет' },
    { insert: 'срок:сегодня', hint: 'Срок сегодня' },
    { insert: 'срок:неделя', hint: 'Срок на этой неделе' },
    { insert: 'срок:просрочено', hint: 'Срок уже прошёл' },
    { insert: 'срок:нет', hint: 'Без срока' },
    { insert: 'цель:нет', hint: 'Не привязана к цели' },
    { insert: 'проект:нет', hint: 'Вне проекта' },
    { insert: 'тег:нет', hint: 'Без тегов' },
    { insert: 'время:>4ч', hint: 'Больше 4 часов — возможно, застряли' },
    { insert: 'время:0', hint: 'Время ещё не учитывалось' },
    { insert: 'оценка:>2ч', hint: 'Оценка больше 2 часов' },
    { insert: 'есть:сверхоценки', hint: 'Вышла за оценку' },
    { insert: 'есть:идёт', hint: 'Таймер идёт сейчас' },
    { insert: 'создана:неделя', hint: 'Создана на этой неделе' }
  ]
  const needle = fragment.trim().toLowerCase()
  if (needle === '') return suggestions.slice(0, 8)
  return suggestions
    .filter((item) => item.insert.includes(needle) || fuzzyIncludes(item.hint, needle))
    .slice(0, 8)
}

import type { Goal, ISODate, Priority, Project } from '@/types'
import { parseDuration } from './query'
import { addDays, fuzzyIncludes, toISODate, todayISO } from './utils'

// Синтаксис быстрого ввода:
//   Написать текст @лендинг +цель #тег !высокий ~1ч30м ^завтра
// Срок принимает: сегодня, завтра, пн…вс, +3, 2026-10-01.

export interface CaptureResult {
  title: string
  tags: string[]
  priority: Priority
  estimateMinutes: number | null
  dueDate: ISODate | null
  /** Проект, с которым совпал токен `@`. */
  projectId: string | null
  /** Текст токена `@` без совпадений: предлагается создать проект. */
  newProjectName: string | null
  goalId: string | null
}

const PRIORITY_WORDS: Record<string, Priority> = {
  в: 'high',
  выс: 'high',
  высокий: 'high',
  высокая: 'high',
  h: 'high',
  high: 'high',
  с: 'medium',
  ср: 'medium',
  средний: 'medium',
  средняя: 'medium',
  m: 'medium',
  medium: 'medium',
  н: 'low',
  низ: 'low',
  низкий: 'low',
  низкая: 'low',
  l: 'low',
  low: 'low',
  нет: 'none',
  none: 'none'
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const WEEKDAYS_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function parseDueToken(token: string): ISODate | null {
  const value = token.toLowerCase()
  if (value === 'сегодня' || value === 'today') return todayISO()
  if (value === 'завтра' || value === 'tomorrow' || value === 'завтр') {
    return toISODate(addDays(new Date(), 1))
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value

  const relative = /^\+(\d{1,3})$/.exec(value)
  if (relative) return toISODate(addDays(new Date(), Number(relative[1])))

  // День недели трактуется как ближайший будущий, а не сегодняшний.
  const short = value.slice(0, 2)
  let weekdayIndex = WEEKDAYS.indexOf(short)
  if (weekdayIndex === -1) weekdayIndex = WEEKDAYS_EN.indexOf(value.slice(0, 3))
  if (weekdayIndex !== -1) {
    const today = new Date()
    const delta = (weekdayIndex - today.getDay() + 7) % 7
    return toISODate(addDays(today, delta === 0 ? 7 : delta))
  }
  return null
}

export function parseCapture(input: string, projects: Project[], goals: Goal[]): CaptureResult {
  const result: CaptureResult = {
    title: '',
    tags: [],
    priority: 'none',
    estimateMinutes: null,
    dueDate: null,
    projectId: null,
    newProjectName: null,
    goalId: null
  }

  const words: string[] = []
  for (const token of input.split(/\s+/)) {
    if (token === '') continue
    const body = token.slice(1)

    if (token.startsWith('#') && body !== '') {
      result.tags.push(body.toLowerCase())
      continue
    }
    if (token.startsWith('!') && body !== '') {
      const priority = PRIORITY_WORDS[body.toLowerCase()]
      if (priority !== undefined) {
        result.priority = priority
        continue
      }
    }
    if (token.startsWith('~') && body !== '') {
      const minutes = parseDuration(body)
      if (minutes !== null && minutes > 0) {
        result.estimateMinutes = minutes
        continue
      }
    }
    if (token.startsWith('^') && body !== '') {
      const due = parseDueToken(body)
      if (due !== null) {
        result.dueDate = due
        continue
      }
    }
    if (token.startsWith('@') && body !== '') {
      const name = body.replace(/-/g, ' ')
      const match = projects.find((project) => fuzzyIncludes(project.title, name))
      if (match === undefined) result.newProjectName = name
      else result.projectId = match.id
      continue
    }
    if (token.startsWith('+') && body !== '' && !/^\d/.test(body)) {
      const name = body.replace(/-/g, ' ')
      const match = goals.find((goal) => fuzzyIncludes(goal.title, name))
      if (match !== undefined) {
        result.goalId = match.id
        continue
      }
    }
    words.push(token)
  }

  result.title = words.join(' ').trim()
  return result
}

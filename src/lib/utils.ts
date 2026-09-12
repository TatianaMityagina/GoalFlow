import type { ISODate, ISODateTime } from '@/types'

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function nowISO(): ISODateTime {
  return new Date().toISOString()
}

// Смещение вычитается, чтобы дата соответствовала местному дню, а не UTC.
export function toISODate(date: Date): ISODate {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function todayISO(): ISODate {
  return toISODate(new Date())
}

// Разбор по частям, а не через Date.parse: строка вида ГГГГ-ММ-ДД трактуется
// стандартом как UTC и при отрицательном смещении даёт предыдущий день.
export function fromISODate(value: ISODate): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Начало недели (понедельник). */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const weekday = (start.getDay() + 6) % 7
  return addDays(start, -weekday)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** Отрицательное значение означает прошедшую дату. */
export function daysUntil(day: ISODate): number {
  const target = fromISODate(day).getTime()
  const today = fromISODate(todayISO()).getTime()
  return Math.round((target - today) / 86_400_000)
}

/** `plural(5, 'день', 'дня', 'дней')` → `дней`. */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return many
  if (n1 > 1 && n1 < 5) return few
  if (n1 === 1) return one
  return many
}

/** `95` → `1 ч 35 мин`. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} мин`
  if (m === 0) return `${h} ч`
  return `${h} ч ${m} мин`
}

/** Редактируемая запись длительности: `90` → `1ч30м`. */
export function formatDurationToken(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}м`
  return m === 0 ? `${h}ч` : `${h}ч${m}м`
}

export function formatStopwatch(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** `Сегодня`, `Завтра`, `Просрочено на 3 дня`, `12 окт.`. */
export function formatDueDate(day: ISODate): string {
  const diff = daysUntil(day)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  if (diff === -1) return 'Вчера'
  if (diff < -1) {
    const late = Math.abs(diff)
    return `Просрочено на ${late} ${plural(late, 'день', 'дня', 'дней')}`
  }
  if (diff <= 7) return `Через ${diff} ${plural(diff, 'день', 'дня', 'дней')}`
  return fromISODate(day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function formatDateTime(value: ISODateTime): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatTime(value: ISODateTime): string {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Цвет выводится из id, поэтому не меняется между перезагрузками. */
export function colorFromSeed(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return `hsl(${Math.abs(hash) % 360} 68% 52%)`
}

export function fuzzyIncludes(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase())
}

/** Совпадение по подпоследовательности: `фкп` находит «Фильтр как парсер». */
export function subsequenceMatch(haystack: string, needle: string): boolean {
  if (needle === '') return true
  const h = haystack.toLocaleLowerCase()
  const n = needle.toLocaleLowerCase()
  let index = 0
  for (const char of n) {
    index = h.indexOf(char, index)
    if (index === -1) return false
    index += 1
  }
  return true
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

// Через JSON, а не structuredClone: последний бросает DataCloneError
// на реактивных прокси Vue. Все хранимые значения JSON-совместимы.
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function downloadFile(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

import type { Goal, Priority, Project, Settings, Task } from '@/types'
import { formatMinutes, plural, todayISO, toISODate } from './utils'

// Два уровня: локальные эвристики работают всегда и офлайн; при включённом
// AI с ключом Anthropic те же функции обращаются к Claude и при любой ошибке
// откатываются на эвристики. Результат — предложение, а не готовое действие.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export interface Suggestion {
  projectId: string | null
  goalId: string | null
  tags: string[]
  priority: Priority
  dueDate: string | null
  estimateMinutes: number | null
  /** Объяснение для пользователя. */
  rationale: string
  source: 'local' | 'claude'
}

export interface Insight {
  title: string
  detail: string
  /** Запрос, показывающий задачи, о которых идёт речь. */
  query?: string
}

/* Локальные эвристики */

const TAG_RULES: Array<{ tag: string; patterns: RegExp }> = [
  { tag: 'текст', patterns: /(напис|текст|копирайт|статья|пост|описан|readme|документ|write|draft|copy)/i },
  { tag: 'дизайн', patterns: /(дизайн|макет|figma|фигма|вёрстк|верстк|шрифт|икон|интерфейс|design|layout)/i },
  { tag: 'код', patterns: /(код|сверст|реализ|отрефактор|рефактор|почин|баг|деплой|api|тест|компонент|build|implement|fix)/i },
  { tag: 'встреча', patterns: /(встреч|созвон|созвон|звонок|созво|интервью|митап|стендап|meet|call|sync)/i },
  { tag: 'бумаги', patterns: /(счёт|счет|налог|бухгалт|документы|оплат|банк|договор|invoice|tax)/i },
  { tag: 'учёба', patterns: /(прочит|изуч|курс|глава|разобрат|исследов|read|study|learn|research)/i },
  { tag: 'обдумать', patterns: /(подума|обдума|спланир|реши|прикин|страте|иде|think|plan|decide)/i }
]

const HIGH_PRIORITY = /(срочн|важн|критич|горит|блокер|дедлайн|сегодня|asap|urgent)/i
const LOW_PRIORITY = /(когда-нибудь|потом|не срочно|необязательн|идея|someday|maybe)/i

// Грубая оценка длительности по глаголу.
const ESTIMATE_RULES: Array<{ minutes: number; patterns: RegExp }> = [
  { minutes: 15, patterns: /(позвон|написать письмо|ответ|заказ|записать|проверить почту|call|email|reply)/i },
  { minutes: 30, patterns: /(просмотр|прочит|обнови|поправ|переимен|review|update|tweak)/i },
  { minutes: 120, patterns: /(напис|состав|дизайн|свёрст|сверст|реализ|сдела|write|design|implement)/i },
  { minutes: 240, patterns: /(исследов|рефактор|перенест|редизайн|архитектур|research|refactor|migrate)/i }
]

function scoreOverlap(text: string, against: string): number {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3)
  )
  if (words.size === 0) return 0
  const targetWords = against
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 3)
  let hits = 0
  for (const word of targetWords) if (words.has(word)) hits += 1
  return hits / Math.max(1, targetWords.length)
}

export interface SuggestionContext {
  goals: Goal[]
  projects: Project[]
  tasks: Task[]
}

export function suggestLocally(title: string, context: SuggestionContext): Suggestion {
  const reasons: string[] = []

  // Проект выбирается по пересечению слов с названием и недавними задачами.
  let bestProject: { id: string; score: number } | null = null
  for (const project of context.projects) {
    if (project.archived) continue
    const projectTasks = context.tasks.filter((task) => task.projectIds.includes(project.id))
    const corpus = [project.title, project.note, ...projectTasks.slice(-12).map((task) => task.title)].join(' ')
    const score = scoreOverlap(title, project.title) * 2 + scoreOverlap(title, corpus)
    if (score > 0.15 && (bestProject === null || score > bestProject.score)) {
      bestProject = { id: project.id, score }
    }
  }
  if (bestProject !== null) {
    const project = context.projects.find((candidate) => candidate.id === bestProject?.id)
    if (project) reasons.push(`формулировка пересекается с «${project.title}»`)
  }

  const tags = TAG_RULES.filter((rule) => rule.patterns.test(title)).map((rule) => rule.tag)
  if (tags.length > 0) reasons.push(`похоже на ${tags.join(' / ')}`)

  let priority: Priority = 'none'
  if (HIGH_PRIORITY.test(title)) {
    priority = 'high'
    reasons.push('формулировка звучит срочно')
  } else if (LOW_PRIORITY.test(title)) {
    priority = 'low'
    reasons.push('формулировка звучит необязательно')
  }

  let estimateMinutes: number | null = null
  for (const rule of ESTIMATE_RULES) {
    if (rule.patterns.test(title)) estimateMinutes = rule.minutes
  }
  if (estimateMinutes !== null) {
    reasons.push(`похожие задачи обычно занимают около ${formatMinutes(estimateMinutes)}`)
  }

  const dueDate = /\bсегодня\b/i.test(title)
    ? todayISO()
    : /\bзавтра\b/i.test(title)
      ? toISODate(new Date(Date.now() + 86_400_000))
      : null

  // Цель берётся только из выбранного проекта и не придумывается.
  const project = bestProject === null ? null : context.projects.find((item) => item.id === bestProject.id) ?? null

  return {
    projectId: project?.id ?? null,
    goalId: project?.goalIds[0] ?? null,
    tags,
    priority,
    dueDate,
    estimateMinutes,
    rationale: reasons.length === 0 ? 'Явных признаков нет — ничего не заполнено.' : reasons.join('; '),
    source: 'local'
  }
}

/** Разбивает задачу на шаги по её формулировке, без обращения к сети. */
export function decomposeLocally(title: string): string[] {
  const clean = title.trim().replace(/\.$/, '')
  if (/(напис|текст|состав|копирайт)/i.test(clean)) {
    return ['Составить план текста', 'Написать черновик', 'Отредактировать и сократить', 'Вычитать начисто']
  }
  if (/(дизайн|макет|вёрстк|верстк)/i.test(clean)) {
    return ['Собрать референсы', 'Набросать два варианта', 'Собрать выбранный', 'Проверить на мобильной ширине']
  }
  if (/(реализ|сдела|код|компонент|сверст)/i.test(clean)) {
    return ['Продумать структуру данных', 'Сделать основной сценарий', 'Закрыть крайние случаи', 'Проверить, что работает']
  }
  if (/(исследов|изуч|прочит|разобрат)/i.test(clean)) {
    return ['Собрать источники', 'Прочитать и выписать', 'Сформулировать выводы', 'Решить, что дальше']
  }
  return [`Спланировать: ${clean}`, `Сделать основную часть: ${clean}`, 'Проверить и завершить']
}

/* Наблюдения */

export interface InsightContext extends SuggestionContext {
  spentMinutes: (taskId: string) => number
  entriesByDay: Map<string, number>
}

/** Считается по локальным данным, без обращения к модели. */
export function buildInsights(context: InsightContext): Insight[] {
  const insights: Insight[] = []
  const open = context.tasks.filter((task) => task.status !== 'done')

  const stuck = open.filter((task) => context.spentMinutes(task.id) > 240)
  if (stuck.length > 0) {
    insights.push({
      title: `${stuck.length} ${plural(stuck.length, 'задача', 'задачи', 'задач')} дольше 4 часов`,
      detail: `Всё ещё не закрыты при большом учтённом времени; дольше всех — «${stuck[0]?.title}». Может, стоит разбить?`,
      query: 'время:>4ч -статус:готово'
    })
  }

  const orphans = open.filter((task) => task.goalIds.length === 0 && task.projectIds.length === 0)
  if (orphans.length >= 3) {
    insights.push({
      title: `${orphans.length} ${plural(orphans.length, 'задача', 'задачи', 'задач')} ни к чему не привязаны`,
      detail: 'Именно такие задачи тихо никогда не делаются. Привяжите к цели или удалите.',
      query: 'цель:нет проект:нет -статус:готово'
    })
  }

  const overdue = open.filter((task) => task.dueDate !== null && task.dueDate < todayISO())
  if (overdue.length > 0) {
    insights.push({
      title: `Просрочено: ${overdue.length}`,
      detail: 'Либо перенесите даты, либо сами задачи — просроченный срок перестаёт что-либо значить.',
      query: 'срок:просрочено'
    })
  }

  const overrun = open.filter(
    (task) => task.estimateMinutes !== null && context.spentMinutes(task.id) > task.estimateMinutes * 1.5
  )
  if (overrun.length > 0) {
    insights.push({
      title: `Превысили оценку в 1,5 раза: ${overrun.length}`,
      detail: 'Похоже, оценки для такой работы занижены — это полезно учитывать при планировании.',
      query: 'есть:сверхоценки -статус:готово'
    })
  }

  const byWeekday = new Map<number, number>()
  for (const [day, minutes] of context.entriesByDay) {
    const weekday = new Date(`${day}T12:00:00`).getDay()
    byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + minutes)
  }
  const busiest = [...byWeekday.entries()].sort((a, b) => b[1] - a[1])[0]
  if (busiest !== undefined && busiest[1] > 60) {
    const names = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
    insights.push({
      title: `Самый загруженный день — ${names[busiest[0]]}`,
      detail: `Всего учтено ${formatMinutes(busiest[1])}. Либо берегите этот день, либо распределите нагрузку.`
    })
  }

  const untracked = open.filter((task) => context.spentMinutes(task.id) === 0 && task.status === 'doing')
  if (untracked.length > 0) {
    insights.push({
      title: `В работе без учёта времени: ${untracked.length}`,
      detail: 'Либо забыли таймер, либо на самом деле работа ещё не начата.',
      query: 'статус:вработе есть:безучёта'
    })
  }

  return insights
}

/** Сводка за период, собранная локально. */
export function buildLocalReport(context: InsightContext, days: number): string {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const completed = context.tasks.filter((task) => task.completedAt !== null && task.completedAt >= since)
  const totalMinutes = [...context.entriesByDay.entries()]
    .filter(([day]) => day >= since.slice(0, 10))
    .reduce((sum, [, minutes]) => sum + minutes, 0)

  const lines: string[] = []
  lines.push(`# Последние ${days} ${plural(days, 'день', 'дня', 'дней')}`, '')
  lines.push(`**Учтено времени:** ${formatMinutes(totalMinutes)} · **Завершено задач:** ${completed.length}`, '')

  const byGoal = new Map<string, string[]>()
  for (const task of completed) {
    const goalIds = new Set<string>(task.goalIds)
    task.projectIds.forEach((projectId) => {
      context.projects
        .find((project) => project.id === projectId)
        ?.goalIds.forEach((goalId) => goalIds.add(goalId))
    })
    const key = goalIds.size === 0 ? 'Без цели' : [...goalIds][0] ?? 'Без цели'
    const list = byGoal.get(key) ?? []
    list.push(task.title)
    byGoal.set(key, list)
  }

  if (byGoal.size === 0) {
    lines.push('_За этот период ничего не завершено._')
  } else {
    for (const [goalId, titles] of byGoal) {
      const goal = context.goals.find((candidate) => candidate.id === goalId)
      lines.push(`## ${goal?.title ?? 'Без цели'}`)
      titles.forEach((title) => lines.push(`- ${title}`))
      lines.push('')
    }
  }

  const open = context.tasks.filter((task) => task.status === 'doing')
  if (open.length > 0) {
    lines.push('## Ещё в работе')
    open.forEach((task) => lines.push(`- ${task.title} (${formatMinutes(context.spentMinutes(task.id))})`))
  }

  return lines.join('\n')
}

/* Вызовы Claude */

interface AnthropicTextBlock {
  type: string
  text?: string
}

interface AnthropicResponse {
  content?: AnthropicTextBlock[]
  error?: { message?: string }
}

class AiUnavailableError extends Error {}

async function askClaude(settings: Settings, system: string, user: string, maxTokens = 1024): Promise<string> {
  if (!settings.aiEnabled || settings.aiApiKey.trim() === '') {
    throw new AiUnavailableError('AI выключен или не указан ключ API.')
  }

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.aiApiKey.trim(),
      'anthropic-version': '2023-06-01',
      // Обязателен для вызовов Anthropic напрямую из браузера.
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: settings.aiModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  })

  const payload = (await response.json()) as AnthropicResponse
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Запрос завершился со статусом ${response.status}`)
  }
  const text = (payload.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
  if (text.trim() === '') throw new Error('Claude вернул пустой ответ.')
  return text
}

/** Извлекает первый объект JSON из ответа, возможно обёрнутого в текст. */
function extractJSON(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('В ответе нет объекта JSON.')
  return JSON.parse(candidate.slice(start, end + 1)) as unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

const SUGGEST_SYSTEM = `Ты раскладываешь новые задачи по существующему таск-менеджеру.
Тебе дают цели и проекты пользователя, затем название одной новой задачи.
Ответь только JSON, без пояснений:
{"projectId": string|null, "tags": string[], "priority": "none"|"low"|"medium"|"high", "estimateMinutes": number|null, "rationale": string}
Правила:
- projectId ОБЯЗАН быть одним из переданных id или null. Никогда не выдумывай id.
- Не больше 3 коротких тегов в нижнем регистре, на русском языке.
- estimateMinutes — реалистичная оценка в минутах или null, если определить нельзя.
- rationale — одно короткое предложение на русском языке.
- Лучше null, чем слабая догадка. Неверное предложение хуже пустого.`

export async function suggestWithClaude(
  title: string,
  context: SuggestionContext,
  settings: Settings
): Promise<Suggestion> {
  // Передаются только id и названия; заметки — лишь при явном разрешении.
  const projectLines = context.projects
    .filter((project) => !project.archived)
    .map((project) => {
      const goalTitles = project.goalIds
        .map((goalId) => context.goals.find((goal) => goal.id === goalId)?.title)
        .filter(Boolean)
        .join(', ')
      const note = settings.aiShareNotes && project.note !== '' ? ` — ${project.note}` : ''
      return `- ${project.id} | ${project.title}${goalTitles === '' ? '' : ` (цель: ${goalTitles})`}${note}`
    })
    .join('\n')

  const knownTags = [...new Set(context.tasks.flatMap((task) => task.tags))].slice(0, 30).join(', ')

  const prompt = [
    'Проекты:',
    projectLines === '' ? '(пока нет)' : projectLines,
    '',
    `Уже используемые теги: ${knownTags === '' ? '(нет)' : knownTags}`,
    '',
    `Новая задача: ${title}`
  ].join('\n')

  const raw = await askClaude(settings, SUGGEST_SYSTEM, prompt, 512)
  const parsed = asRecord(extractJSON(raw))

  const projectId = typeof parsed.projectId === 'string' ? parsed.projectId : null
  const project = context.projects.find((candidate) => candidate.id === projectId) ?? null
  const priorities: Priority[] = ['none', 'low', 'medium', 'high']
  const priority =
    typeof parsed.priority === 'string' && (priorities as string[]).includes(parsed.priority)
      ? (parsed.priority as Priority)
      : 'none'

  return {
    // Несуществующий id отбрасывается.
    projectId: project?.id ?? null,
    goalId: project?.goalIds[0] ?? null,
    tags: asStringArray(parsed.tags).slice(0, 3).map((tag) => tag.toLowerCase()),
    priority,
    dueDate: null,
    estimateMinutes:
      typeof parsed.estimateMinutes === 'number' && Number.isFinite(parsed.estimateMinutes)
        ? Math.round(parsed.estimateMinutes)
        : null,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'Предложено Claude.',
    source: 'claude'
  }
}

const DECOMPOSE_SYSTEM = `Ты разбиваешь одну задачу на подзадачи.
Ответь только JSON: {"steps": string[]}
Правила:
- От 3 до 6 шагов, каждый — конкретное действие, начинающееся с глагола.
- Каждый шаг выполним за один подход.
- Тот же язык, что и во входных данных. Без нумерации и пояснений.`

export async function decomposeWithClaude(title: string, note: string, settings: Settings): Promise<string[]> {
  const body = settings.aiShareNotes && note.trim() !== '' ? `${title}\n\nКонтекст: ${note}` : title
  const raw = await askClaude(settings, DECOMPOSE_SYSTEM, body, 512)
  const parsed = asRecord(extractJSON(raw))
  const steps = asStringArray(parsed.steps).map((step) => step.trim()).filter(Boolean)
  if (steps.length === 0) throw new Error('Claude не предложил ни одного шага.')
  return steps.slice(0, 6)
}

const REPORT_SYSTEM = `Ты пишешь короткую человеческую сводку о работе за период.
На входе — список завершённых задач с учтённым временем, сгруппированный по целям.
Напиши на русском языке в формате markdown: один вводный абзац простым языком,
затем короткий раздел по каждой цели со списком, затем одно честное наблюдение
о том, куда на самом деле ушло время. Без канцелярита и похвалы ради похвалы.
Не длиннее 300 слов.`

export async function reportWithClaude(
  context: InsightContext,
  days: number,
  settings: Settings
): Promise<string> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const completed = context.tasks.filter((task) => task.completedAt !== null && task.completedAt >= since)

  const lines = completed.map((task) => {
    const goalTitles = task.goalIds
      .map((goalId) => context.goals.find((goal) => goal.id === goalId)?.title)
      .concat(
        task.projectIds.flatMap((projectId) =>
          (context.projects.find((project) => project.id === projectId)?.goalIds ?? []).map(
            (goalId) => context.goals.find((goal) => goal.id === goalId)?.title
          )
        )
      )
      .filter((value): value is string => typeof value === 'string')
    const goalLabel = goalTitles.length === 0 ? 'Без цели' : [...new Set(goalTitles)].join(', ')
    return `- [${goalLabel}] ${task.title} — ${formatMinutes(context.spentMinutes(task.id))}`
  })

  const totalMinutes = [...context.entriesByDay.entries()]
    .filter(([day]) => day >= since.slice(0, 10))
    .reduce((sum, [, minutes]) => sum + minutes, 0)

  const prompt = [
    `Период: последние ${days} ${plural(days, 'день', 'дня', 'дней')}.`,
    `Всего учтено времени: ${formatMinutes(totalMinutes)}.`,
    '',
    'Завершённые задачи:',
    lines.length === 0 ? '(нет)' : lines.join('\n')
  ].join('\n')

  return askClaude(settings, REPORT_SYSTEM, prompt, 1400)
}

/** Возможно ли сейчас обращение к модели. */
export function claudeReady(settings: Settings): boolean {
  return settings.aiEnabled && settings.aiApiKey.trim() !== ''
}

// Проверка логики: разбор запросов, быстрый ввод, нормализация хранилища,
// учёт времени. Запуск: npm test.

import './browser-stubs'

import { filterTasks, parseDuration, parseQuery } from '../src/lib/query'
import { parseCapture } from '../src/lib/capture'
import { normalizeDatabase } from '../src/lib/storage'
import { daysUntil, formatMinutes, formatStopwatch, plural, toISODate } from '../src/lib/utils'
import { store } from '../src/stores/store'

let failures = 0
let checks = 0

function check(label: string, condition: boolean): void {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}`)
  }
}

function group(name: string): void {
  console.log(`\n${name}`)
}

// browser-stubs обязан быть первым импортом: он ставит localStorage и window
// до выполнения тела модуля стора.

/* ------------------------------- utils -------------------------------- */

group('утилиты')
check('formatMinutes(95) даёт «1 ч 35 мин»', formatMinutes(95) === '1 ч 35 мин')
check('formatMinutes(60) даёт «1 ч»', formatMinutes(60) === '1 ч')
check('formatMinutes(0) даёт «0 мин»', formatMinutes(0) === '0 мин')
check('formatStopwatch(3725) даёт «1:02:05»', formatStopwatch(3725) === '1:02:05')
check('formatStopwatch(65) даёт «01:05»', formatStopwatch(65) === '01:05')
check('daysUntil(сегодня) равно 0', daysUntil(toISODate(new Date())) === 0)
check('склонение: 1 день / 2 дня / 5 дней',
  plural(1, 'день', 'дня', 'дней') === 'день' &&
  plural(2, 'день', 'дня', 'дней') === 'дня' &&
  plural(5, 'день', 'дня', 'дней') === 'дней' &&
  plural(11, 'день', 'дня', 'дней') === 'дней')

/* ------------------------------- query -------------------------------- */

group('разбор запросов')
const parsed = parseQuery('статус:вработе -срок:нет #дизайн написать текст')
check('разобрано три клаузы', parsed.clauses.length === 3)
check('отрицание распознано', parsed.clauses.some((c) => c.key === 'due' && c.negated))
check('#тег становится клаузой tag', parsed.clauses.some((c) => c.key === 'tag' && c.value === 'дизайн'))
check('свободный текст сохранён', parsed.text === 'написать текст')

const ru = parseQuery('статус:готово приоритет:высокий')
check('русский ключ сводится к каноническому', ru.clauses[0]?.key === 'status')
check('русское значение сводится к каноническому', ru.clauses[0]?.value === 'done')
check('приоритет переводится', ru.clauses[1]?.value === 'high')

const en = parseQuery('status:done priority:high')
check('английский синтаксис по-прежнему работает',
  en.clauses[0]?.value === 'done' && en.clauses[1]?.value === 'high')

check('parseDuration («4ч») равно 240', parseDuration('4ч') === 240)
check('parseDuration («1ч30м») равно 90', parseDuration('1ч30м') === 90)
check('parseDuration («45м») равно 45', parseDuration('45м') === 45)
check('parseDuration («4h») равно 240', parseDuration('4h') === 240)
check('parseDuration («90») равно 90', parseDuration('90') === 90)
check('parseDuration («ерунда») равно null', parseDuration('ерунда') === null)

/* ------------------------------- store -------------------------------- */

group('стор: иерархия')
const goal = store.createGoal('Запустить продукт')
const project = store.createProject('Лендинг', [goal.id])
const task = store.createTask({ title: 'Написать текст для первого экрана', projectIds: [project.id], tags: ['текст'] })
const loose = store.createTask({ title: 'Позвонить бухгалтеру' })

check('задача наследует цель через проект', store.tasksOfGoal(goal.id).some((t) => t.id === task.id))
check('свободная задача не попадает под цель', !store.tasksOfGoal(goal.id).some((t) => t.id === loose.id))
check('прогресс цели начинается с 0%', store.goalProgress.value.get(goal.id)?.percent === 0)

store.updateTask(task.id, { status: 'done' })
check('прогресс цели доходит до 100%, когда её единственная задача готова',
  store.goalProgress.value.get(goal.id)?.percent === 100)
check('проставляется completedAt', store.taskById(task.id)?.completedAt !== null)

store.updateTask(task.id, { status: 'todo' })
check('completedAt сбрасывается при возврате в работу', store.taskById(task.id)?.completedAt === null)

group('стор: учёт времени')
store.addManualEntry(task.id, 300, 'долгая сессия')
check('ручная запись учитывается', store.spentMinutes(task.id) === 300)

store.startTimer(loose.id)
check('запуск таймера переводит задачу в работу', store.taskById(loose.id)?.status === 'doing')
check('идёт ровно одна запись', store.runningEntry.value?.taskId === loose.id)

store.startTimer(task.id)
check('запуск другого таймера останавливает первый', store.runningEntry.value?.taskId === task.id)
check('сессия короче минуты не оставляет записи', store.entriesOfTask(loose.id).length === 0)

store.updateTask(task.id, { status: 'done' })
check('завершение задачи останавливает её таймер', store.runningEntry.value === null)

group('стор: фильтры')
const context = store.queryContext.value
check(
  'время:>4ч находит долгую задачу',
  filterTasks(store.db.tasks, 'время:>4ч', context).some((t) => t.id === task.id)
)
check(
  'цель:нет находит свободную задачу',
  filterTasks(store.db.tasks, 'цель:нет', context).some((t) => t.id === loose.id)
)
check(
  'цель:нет исключает привязанную задачу',
  !filterTasks(store.db.tasks, 'цель:нет', context).some((t) => t.id === task.id)
)
check(
  'тег:текст находит задачу',
  filterTasks(store.db.tasks, 'тег:текст', context).some((t) => t.id === task.id)
)
check(
  '-статус:готово исключает завершённое',
  !filterTasks(store.db.tasks, '-статус:готово', context).some((t) => t.id === task.id)
)
check(
  'свободный текст ищет по названиям',
  filterTasks(store.db.tasks, 'бухгалтеру', context).length === 1
)

/* ------------------------------- capture ------------------------------ */

group('быстрый ввод')
const capture = parseCapture(
  'Написать текст для первого экрана @лендинг #текст !высокий ~90м ^сегодня',
  store.db.projects,
  store.db.goals
)
check('из названия убраны все токены', capture.title === 'Написать текст для первого экрана')
check('@лендинг находит проект', capture.projectId === project.id)
check('#текст становится тегом', capture.tags.includes('текст'))
check('!высокий ставит приоритет', capture.priority === 'high')
check('~90м ставит оценку', capture.estimateMinutes === 90)
check('^сегодня ставит срок', capture.dueDate === toISODate(new Date()))

const newProject = parseCapture('Сделать что-то @совсем-новый-проект', store.db.projects, store.db.goals)
check('несовпавший токен @ предлагается как новый проект',
  newProject.newProjectName === 'совсем новый проект')

/* ------------------------- export / import ---------------------------- */

group('экспорт и импорт')
const backup = store.exportJSON()
const restored = normalizeDatabase(JSON.parse(backup))
check('бэкап сохраняет все задачи', restored.tasks.length === store.db.tasks.length)
check('бэкап сохраняет записи времени', restored.timeEntries.length === store.db.timeEntries.length)
check('ключ API никогда не попадает в бэкап', restored.settings.aiApiKey === '')

const legacy = normalizeDatabase([
  {
    id: 'g1',
    title: 'Old goal',
    projects: [{ id: 'p1', title: 'Old project', tasks: [{ id: 't1', title: 'Old task', status: 'pending' }] }]
  }
])
check('старый вложенный формат импортируется', legacy.tasks.length === 1 && legacy.goals.length === 1)
check('у старых задач сохраняется связь с проектом', legacy.tasks[0]?.projectIds[0] === 'p1')
check('неизвестный статус заменяется на todo', legacy.tasks[0]?.status === 'todo')

const garbage = normalizeDatabase({ tasks: 'not an array', goals: [{ title: 42 }] })
check('битые данные не роняют разбор', garbage.tasks.length === 0 && garbage.goals.length === 1)
check('нестроковое название заменяется', garbage.goals[0]?.title === 'Цель без названия')

const csv = store.exportTasksCSV()
check('в CSV есть заголовок и строка на каждую задачу', csv.split('\n').length === store.db.tasks.length + 1)

/* -------------------------------- result ------------------------------ */

console.log(`\nпройдено проверок: ${checks - failures} из ${checks}`)
if (failures > 0) process.exit(1)

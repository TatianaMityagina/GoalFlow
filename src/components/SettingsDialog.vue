<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { store } from '@/stores/store'
import type { ImportMode } from '@/stores/store'
import type { ThemePreference } from '@/types'
import { downloadFile, formatMinutes, todayISO } from '@/lib/utils'
import { STORAGE_KEY } from '@/lib/storage'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const fileInput = ref<HTMLInputElement | null>(null)
const importMode = ref<ImportMode>('merge')
const confirmingReset = ref<boolean>(false)

function exportJSON(): void {
  downloadFile(`goalflow-backup-${todayISO()}.json`, store.exportJSON(), 'application/json')
  store.pushToast('Бэкап выгружен', 'success')
}

function exportTasksCSV(): void {
  downloadFile(`goalflow-tasks-${todayISO()}.csv`, store.exportTasksCSV(), 'text/csv')
}

function exportTimeCSV(): void {
  downloadFile(`goalflow-time-${todayISO()}.csv`, store.exportTimeCSV(), 'text/csv')
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file === undefined) return
  const text = await file.text()
  store.importJSON(text, importMode.value)
  // Сброс значения: иначе повторный выбор того же файла не даст события.
  input.value = ''
}

const THEMES: Array<{ id: ThemePreference; label: string }> = [
  { id: 'system', label: 'Как в системе' },
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' }
]

/** Объём данных в localStorage. */
const storageSize = computed<string>(() => {
  const raw = localStorage.getItem(STORAGE_KEY) ?? ''
  const kb = new Blob([raw]).size / 1024
  return kb < 1024 ? `${kb.toFixed(1)} КБ` : `${(kb / 1024).toFixed(2)} МБ`
})

function doReset(): void {
  store.resetAll()
  confirmingReset.value = false
  emit('close')
}
</script>

<template>
  <div v-if="props.open" class="overlay" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Настройки">
      <header class="modal__head">
        <Icon name="settings" :size="16" />
        <h2 class="modal__title">Настройки</h2>
        <button class="btn btn--ghost btn--sm btn--icon" aria-label="Закрыть" @click="emit('close')">
          <Icon name="close" :size="15" />
        </button>
      </header>

      <div class="modal__body">
        <section class="field">
          <span class="field__label">Внешний вид</span>
          <div class="segmented" style="align-self: flex-start">
            <button
              v-for="theme in THEMES"
              :key="theme.id"
              class="segmented__btn"
              :class="{ 'segmented__btn--active': store.db.settings.theme === theme.id }"
              @click="store.updateSettings({ theme: theme.id })"
            >
              {{ theme.label }}
            </button>
          </div>
        </section>

        <section class="field">
          <label class="field__label" for="idle">Предупреждать о забытом таймере через</label>
          <div class="row">
            <input
              id="idle"
              class="input"
              style="width: 100px"
              type="number"
              min="5"
              max="600"
              step="5"
              :value="store.db.settings.idleThresholdMinutes"
              @change="
                store.updateSettings({
                  idleThresholdMinutes: Math.max(
                    5,
                    Number(($event.target as HTMLInputElement).value) || 90
                  )
                })
              "
            />
            <span class="text-sm muted">минут</span>
          </div>
          <p class="field__hint">
            Сейчас {{ formatMinutes(store.db.settings.idleThresholdMinutes) }}. После этого GoalFlow
            спросит, работаете ли вы ещё, и предложит обрезать сессию, а не записывать восьмичасовой обед.
          </p>
        </section>

        <hr class="divider" />

        <section class="stack stack--sm">
          <span class="field__label">Ваши данные</span>
          <p class="field__hint">
            Всё хранится в localStorage этого браузера (занято {{ storageSize }}) и только на этом
            устройстве. Никуда не отправляется. Очистка данных сайта удалит их — делайте бэкапы.
          </p>
          <div class="row row--wrap">
            <button class="btn btn--default btn--sm" @click="exportJSON">
              <Icon name="download" :size="13" /> Бэкап (JSON)
            </button>
            <button class="btn btn--default btn--sm" @click="exportTasksCSV">
              <Icon name="download" :size="13" /> Задачи (CSV)
            </button>
            <button class="btn btn--default btn--sm" @click="exportTimeCSV">
              <Icon name="download" :size="13" /> Лог времени (CSV)
            </button>
          </div>

          <div class="row row--wrap" style="margin-top: var(--space-2)">
            <select v-model="importMode" class="select" style="width: auto" aria-label="Режим импорта">
              <option value="merge">Добавить к текущим данным</option>
              <option value="replace">Заменить всё</option>
            </select>
            <button class="btn btn--default btn--sm" @click="fileInput?.click()">
              <Icon name="upload" :size="13" /> Восстановить из файла
            </button>
            <input
              ref="fileInput"
              type="file"
              accept="application/json,.json"
              class="sr-only"
              @change="onFileChosen"
            />
          </div>

          <div class="row row--wrap" style="margin-top: var(--space-2)">
            <button class="btn btn--ghost btn--sm" @click="store.loadSampleData()">
              <Icon name="sparkles" :size="13" /> Загрузить пример
            </button>
            <span class="spacer" />
            <button v-if="!confirmingReset" class="btn btn--ghost btn--sm" @click="confirmingReset = true">
              <Icon name="trash" :size="13" /> Удалить все данные
            </button>
            <template v-else>
              <span class="text-xs">Удалить все цели, проекты, задачи и записи времени?</span>
              <button class="btn btn--danger btn--sm" @click="doReset">Да, удалить</button>
              <button class="btn btn--ghost btn--sm" @click="confirmingReset = false">Отмена</button>
            </template>
          </div>
        </section>

        <hr class="divider" />

        <section class="stack stack--sm">
          <label class="row" style="gap: var(--space-3)">
            <input
              class="switch"
              type="checkbox"
              :checked="store.db.settings.aiEnabled"
              @change="
                store.updateSettings({ aiEnabled: ($event.target as HTMLInputElement).checked })
              "
            />
            <span>
              <span class="field__label" style="display: block">Подсказки AI</span>
              <span class="field__hint">
                По умолчанию выключены. Даже выключенными подсказки работают — просто считаются
                на вашем устройстве по формулировкам и прошлым задачам.
              </span>
            </span>
          </label>

          <template v-if="store.db.settings.aiEnabled">
            <div class="field">
              <label class="field__label" for="api-key">Ключ API Anthropic</label>
              <input
                id="api-key"
                class="input"
                type="password"
                autocomplete="off"
                placeholder="sk-ant-…"
                :value="store.db.settings.aiApiKey"
                @change="store.updateSettings({ aiApiKey: ($event.target as HTMLInputElement).value })"
              />
              <p class="field__hint">
                Хранится только в этом браузере и никогда не попадает в экспорт. Запросы идут
                из браузера напрямую в Anthropic — у GoalFlow нет сервера.
              </p>
            </div>

            <div class="field">
              <label class="field__label" for="model">Модель</label>
              <select
                id="model"
                class="select"
                :value="store.db.settings.aiModel"
                @change="store.updateSettings({ aiModel: ($event.target as HTMLSelectElement).value })"
              >
                <option value="claude-sonnet-5">Claude Sonnet 5 — баланс</option>
                <option value="claude-opus-5">Claude Opus 5 — самая способная</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — самая быстрая</option>
              </select>
            </div>

            <label class="row" style="gap: var(--space-3)">
              <input
                class="switch"
                type="checkbox"
                :checked="store.db.settings.aiShareNotes"
                @change="
                  store.updateSettings({ aiShareNotes: ($event.target as HTMLInputElement).checked })
                "
              />
              <span>
                <span class="field__label" style="display: block">Отправлять и заметки задач</span>
                <span class="field__hint">
                  Выключено: уходят только названия, теги и имена проектов. Включено: уходят и
                  заметки — подсказки точнее, но данных передаётся больше.
                </span>
              </span>
            </label>
          </template>
        </section>

        <hr class="divider" />

        <section class="stack stack--sm">
          <span class="field__label">Клавиатура</span>
          <div class="stack stack--sm text-xs muted">
            <div class="row"><span class="kbd">⌘K</span><span>Палитра команд</span></div>
            <div class="row"><span class="kbd">N</span><span>Новая задача (быстрый ввод)</span></div>
            <div class="row"><span class="kbd">G</span><span>Новая цель</span> <span class="kbd">P</span><span>Новый проект</span></div>
            <div class="row"><span class="kbd">/</span><span>Фокус в строку фильтра</span></div>
            <div class="row"><span class="kbd">1</span><span class="kbd">2</span><span class="kbd">3</span><span>Список / доска / календарь</span></div>
            <div class="row"><span class="kbd">T</span><span>Остановить таймер</span></div>
            <div class="row"><span class="kbd">E</span><span>Выгрузить бэкап</span></div>
            <div class="row"><span class="kbd">?</span><span>Эта панель</span> <span class="kbd">esc</span><span>Закрыть что угодно</span></div>
          </div>
        </section>
      </div>

      <footer class="modal__foot">
        <span class="text-xs faint" style="align-self: center">GoalFlow — ваши данные остаются вашими.</span>
        <span class="modal__foot-spacer" />
        <button class="btn btn--primary btn--sm" @click="emit('close')">Готово</button>
      </footer>
    </div>
  </div>
</template>

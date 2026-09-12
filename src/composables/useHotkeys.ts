import { onBeforeUnmount, onMounted } from 'vue'

export interface Hotkey {
  /** `event.key` в нижнем регистре. */
  key: string
  /** Cmd на macOS, Ctrl на остальных системах. */
  meta?: boolean
  shift?: boolean
  alt?: boolean
  run: (event: KeyboardEvent) => void
  /** Срабатывать и при фокусе в поле ввода. */
  allowInInput?: boolean
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

// Однобуквенные сочетания подавляются при фокусе в поле ввода, иначе буква
// в тексте задачи срабатывала бы как горячая клавиша.
export function useHotkeys(hotkeys: () => Hotkey[]): void {
  function onKeydown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase()
    const meta = event.metaKey || event.ctrlKey
    const typing = isTypingTarget(event.target)

    for (const hotkey of hotkeys()) {
      if (hotkey.key !== key) continue
      if (Boolean(hotkey.meta) !== meta) continue
      if (Boolean(hotkey.shift) !== event.shiftKey) continue
      if (Boolean(hotkey.alt) !== event.altKey) continue
      if (typing && hotkey.allowInInput !== true) continue

      event.preventDefault()
      hotkey.run(event)
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}

// Минимальные браузерные глобальные объекты для импорта стора в Node.
// Импортируется первым: модули выполняются в порядке импортов.

const memory = new Map<string, string>()

const globalScope = globalThis as unknown as Record<string, unknown>

globalScope.localStorage = {
  getItem: (key: string): string | null => memory.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    memory.set(key, value)
  },
  removeItem: (key: string): void => {
    memory.delete(key)
  },
  clear: (): void => memory.clear()
}

globalScope.window = {
  setInterval: (): number => 0,
  setTimeout: (): number => 0,
  clearTimeout: (): void => undefined,
  addEventListener: (): void => undefined,
  removeEventListener: (): void => undefined
}

export const stubsInstalled = true

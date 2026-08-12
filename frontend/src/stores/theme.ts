import { defineStore } from 'pinia'

export type ThemeMode = 'system' | 'light' | 'dark'

const KEY = 'bunker-theme'

/**
 * Тема оформления: system (по умолчанию, следует за ОС) / light / dark.
 * Применяется через атрибут data-theme на <html>.
 */
export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: 'system' as ThemeMode,
  }),
  getters: {
    /** Фактически применённая тема (для иконки переключателя). */
    effective(state): 'light' | 'dark' {
      if (state.mode !== 'system') return state.mode
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    },
  },
  actions: {
    init() {
      const saved = localStorage.getItem(KEY) as ThemeMode | null
      this.mode = saved ?? 'system'
      this.apply()
      // Реагируем на смену системной темы, когда режим = system.
      window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.mode === 'system') this.apply()
      })
    },
    apply() {
      const root = document.documentElement
      if (this.mode === 'system') root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', this.mode)
    },
    set(mode: ThemeMode) {
      this.mode = mode
      localStorage.setItem(KEY, mode)
      this.apply()
    },
    /** Циклическое переключение system → light → dark → system. */
    cycle() {
      const order: ThemeMode[] = ['system', 'light', 'dark']
      const next = order[(order.indexOf(this.mode) + 1) % order.length]
      this.set(next)
    },
  },
})

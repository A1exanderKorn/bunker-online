import { defineStore } from 'pinia'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemeSkin = 'last-light'

const KEY = 'bunker-theme'
// Temporary presentation lock; keep the saved preference for when themes return.
const DARK_ONLY = true

/**
 * Skin controls art direction; mode controls brightness independently.
 * New visitors see Last Light in dark mode; existing preferences are preserved.
 */
export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: 'dark' as ThemeMode,
    skin: 'last-light' as ThemeSkin,
    systemDark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  }),
  getters: {
    /** Фактически применённая тема (для иконки переключателя). */
    effective(state): 'light' | 'dark' {
      if (DARK_ONLY) return 'dark'
      if (state.mode !== 'system') return state.mode
      return state.systemDark ? 'dark' : 'light'
    },
  },
  actions: {
    init() {
      const saved = localStorage.getItem(KEY)
      this.mode = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark'
      this.apply()
      // Реагируем на смену системной темы, когда режим = system.
      window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
        this.systemDark = event.matches
        if (this.mode === 'system') this.apply()
      })
    },
    apply() {
      const root = document.documentElement
      root.setAttribute('data-skin', this.skin)
      root.setAttribute('data-theme', this.effective)
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

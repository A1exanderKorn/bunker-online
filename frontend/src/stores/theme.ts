import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark'
export type ThemeSkin = 'last-light'

const KEY = 'bunker-theme'

/**
 * Skin controls art direction; mode controls brightness independently.
 * New visitors see Last Light in dark mode; existing preferences are preserved.
 */
export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: 'dark' as ThemeMode,
    skin: 'last-light' as ThemeSkin,
  }),
  getters: {
    effective(state): ThemeMode {
      return state.mode
    },
  },
  actions: {
    init() {
      let saved: string | null = null
      try {
        saved = localStorage.getItem(KEY)
      } catch {
        // Theme selection still works when browser storage is unavailable.
      }
      // Migrate the old system setting to one of the two explicit choices.
      let mode: ThemeMode = saved === 'light' ? 'light' : 'dark'
      if (saved === 'system') {
        mode = (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true) ? 'dark' : 'light'
      }
      this.set(mode)
    },
    apply() {
      const root = document.documentElement
      root.setAttribute('data-skin', this.skin)
      root.setAttribute('data-theme', this.effective)
    },
    set(mode: ThemeMode) {
      this.mode = mode
      this.apply()
      try {
        localStorage.setItem(KEY, mode)
      } catch {
        // Keep the selected theme for this session even without persistent storage.
      }
    },
  },
})

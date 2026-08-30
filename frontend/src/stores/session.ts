import { defineStore } from 'pinia'
import type { JoinMode } from '@/services/socket'

const NAME_KEY = 'playerName'
const LOBBY_KEY = 'bunker.lobbyCode'
const MODE_KEY = 'bunker.mode'

/** Читает постоянное значение и один раз переносит старую сессию вкладки. */
function loadStored(key: string): string | null {
  const persistent = localStorage.getItem(key)
  if (persistent !== null) return persistent

  const legacy = sessionStorage.getItem(key)
  if (legacy !== null) {
    localStorage.setItem(key, legacy)
    sessionStorage.removeItem(key)
  }
  return legacy
}

/**
 * Имя игрока, код лобби и режим входа сохраняются в localStorage, поэтому
 * переживают перезагрузку, закрытие вкладки и перезапуск браузера.
 */
export const useSessionStore = defineStore('session', {
  state: () => ({
    name: '',
    lobbyCode: '',
    /** Как мы попали в текущее лобби: создали или присоединились. */
    mode: 'join' as JoinMode,
  }),
  getters: {
    hasName: (state) => state.name.trim().length > 0,
  },
  actions: {
    loadName() {
      this.name = loadStored(NAME_KEY) ?? ''
    },
    /** Восстанавливает последний вход этого браузера (вызывать при монтировании лобби). */
    loadSession() {
      this.name = loadStored(NAME_KEY) ?? ''
      this.lobbyCode = loadStored(LOBBY_KEY) ?? ''
      const savedMode = loadStored(MODE_KEY)
      this.mode = savedMode === 'create' ? 'create' : 'join'
    },
    setName(name: string) {
      this.name = name.trim()
      localStorage.setItem(NAME_KEY, this.name)
    },
    setLobby(code: string, mode: JoinMode = 'join') {
      this.lobbyCode = code.toUpperCase()
      this.mode = mode
      localStorage.setItem(LOBBY_KEY, this.lobbyCode)
      localStorage.setItem(MODE_KEY, this.mode)
    },
  },
})

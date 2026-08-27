import { defineStore } from 'pinia'
import type { JoinMode } from '@/services/socket'

const NAME_KEY = 'playerName'
const LOBBY_KEY = 'bunker.lobbyCode'
const MODE_KEY = 'bunker.mode'

/**
 * Имя игрока, код лобби и режим входа. Всё сохраняется в sessionStorage:
 * перезагрузка страницы (F5) не ломает реконнект, но новая вкладка получает
 * собственную сессию и может войти в то же лобби отдельным игроком.
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
      this.name = sessionStorage.getItem(NAME_KEY) ?? ''
    },
    /** Восстанавливает сессию этой вкладки (вызывать при монтировании лобби). */
    loadSession() {
      this.name = sessionStorage.getItem(NAME_KEY) ?? ''
      this.lobbyCode = sessionStorage.getItem(LOBBY_KEY) ?? ''
      const savedMode = sessionStorage.getItem(MODE_KEY)
      this.mode = savedMode === 'create' ? 'create' : 'join'
    },
    setName(name: string) {
      this.name = name.trim()
      sessionStorage.setItem(NAME_KEY, this.name)
    },
    setLobby(code: string, mode: JoinMode = 'join') {
      this.lobbyCode = code.toUpperCase()
      this.mode = mode
      sessionStorage.setItem(LOBBY_KEY, this.lobbyCode)
      sessionStorage.setItem(MODE_KEY, this.mode)
    },
  },
})

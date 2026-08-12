import { defineStore } from 'pinia'
import type { JoinMode } from '@/services/socket'

const NAME_KEY = 'playerName'

/** Имя игрока и код лобби; имя сохраняется между сессиями. */
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
      this.name = localStorage.getItem(NAME_KEY) ?? ''
    },
    setName(name: string) {
      this.name = name.trim()
      localStorage.setItem(NAME_KEY, this.name)
    },
    setLobby(code: string, mode: JoinMode = 'join') {
      this.lobbyCode = code.toUpperCase()
      this.mode = mode
    },
  },
})

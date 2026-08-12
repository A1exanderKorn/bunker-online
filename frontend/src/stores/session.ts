import { defineStore } from 'pinia'

const NAME_KEY = 'playerName'

/** Имя игрока и код лобби; имя сохраняется между сессиями. */
export const useSessionStore = defineStore('session', {
  state: () => ({
    name: '',
    lobbyCode: '',
  }),
  getters: {
    hasName: (state) => state.name.trim().length > 0,
  },
  actions: {
    loadName() {
      this.name = localStorage.getItem(NAME_KEY) ?? ''
    },
    setName(name: string) {
      this.name = name
      localStorage.setItem(NAME_KEY, name)
    },
    setLobby(code: string) {
      this.lobbyCode = code.toUpperCase()
    },
  },
})

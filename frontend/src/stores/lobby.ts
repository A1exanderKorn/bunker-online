import { defineStore } from 'pinia'

export const useLobbyStore = defineStore('lobby', {
  state: () => ({
    name: '',
    lobbyCode: '',
    players: [] as string[],
    isHost: false,
  }),
  actions: {
    setName(name: string) {
      this.name = name
    },
    setLobby(code: string, isHost = false) {
      this.lobbyCode = code
      this.isHost = isHost
    },
    updatePlayers(players: string[]) {
      this.players = players
    },
  },
})

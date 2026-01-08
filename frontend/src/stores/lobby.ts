import { defineStore } from 'pinia'

export type Player = {
  id: string
  nickname: string
  characteristics: {
    type: string
    value: string
    coef: number
    isVisible: boolean
  }[]
  biology: {
    sex: string
    age: number
    experience: number
    coef: number
    infertile: boolean
    isVisible: boolean
  }
}

export const useLobbyStore = defineStore('lobby', {
  state: () => ({
    name: '',
    lobbyCode: '',
    players: [] as Player[],
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
    updatePlayers(players: Player[]) {
      this.players = players
    },
    initFromLocalStorage() {
      const savedName = localStorage.getItem('playerName')
      if (savedName) {
        this.name = savedName
      }
    },
    setLocalStorage(newName: string) {
      localStorage.setItem('playerName', newName)
    },
  },
})

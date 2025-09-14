import { defineStore } from 'pinia'
import type { Characteristic, Biology } from './player'

export interface PublicPlayerData {
  id: string
  name: string
  characteristics: Characteristic[]
  biology?: Biology
}

export const useGameStateStore = defineStore('gameState', {
  state: () => ({
    players: [] as PublicPlayerData[],
  }),
  actions: {
    setPlayers(players: PublicPlayerData[]) {
      this.players = players
    },
    updatePlayer(playerId: string, updated: Partial<PublicPlayerData>) {
      const idx = this.players.findIndex((p) => p.id === playerId)
      if (idx !== -1) {
        this.players[idx] = { ...this.players[idx], ...updated }
      }
    },
  },
})
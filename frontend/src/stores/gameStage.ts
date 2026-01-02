import { defineStore } from "pinia"
import type { PublicPlayerData } from "./gameState"
import type { GameStage } from "../../../server/index"

export const useGameStageStore = defineStore('game', {
  state: () => ({
    stage: 'discussion' as GameStage,
    currentTurnPlayerId: null as string | null,
    turnDeadline: null as number | null,
    players: [] as PublicPlayerData[]
  }),
  actions: {
    setStage(stage: GameStage, currentTurnPlayerId: string | null, turnDeadline: number | null) {
      this.stage = stage
      this.currentTurnPlayerId = currentTurnPlayerId
      this.turnDeadline = turnDeadline
    }
  }
})
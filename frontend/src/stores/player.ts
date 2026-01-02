import { defineStore } from 'pinia'
import type { Biology, Characteristic } from "../../../server/index"

export const usePlayerStore = defineStore('player', {
  state: () => ({
    id: '',
    nickname: '',
    biology: null as null | Biology, // тип определи по структуре
    characteristics: [] as Characteristic[], // массив характеристик
  }),
  actions: {
    setId(id: string) {
      this.id = id
    },
    setNickname(name: string) {
      this.nickname = name
    },
    setPlayerData(data: { biology: Biology; characteristics: Characteristic[] }) {
      this.biology = data.biology
      this.characteristics = data.characteristics
    },
  },
})

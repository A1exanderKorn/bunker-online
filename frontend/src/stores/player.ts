import { defineStore } from 'pinia'

interface Characteristic {
  type: string
  value: string
  coef: number
  isVisible: boolean
}

interface Biology {
  sex: 'М' | 'Ж' | 'Андроид' | 'Гермафродит'
  age: number
  experience: number
  coef: number
  infertile?: boolean
  isVisible: boolean
}

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

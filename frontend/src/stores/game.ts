import { defineStore } from 'pinia'
import type {
  Biology,
  Characteristic,
  GameStage,
  PublicPlayer,
  VoteResultPayload,
} from '@shared/types'
import { connectSocket, getSocket } from '@/services/socket'

interface RosterPlayer {
  id: string
  name: string
  isAlive: boolean
}

/**
 * Единый стор игры: состояние комнаты, свои характеристики, стадия/таймер
 * и голосование. Всё обновляется по событиям сервера (сервер — источник правды).
 */
export const useGameStore = defineStore('game', {
  state: () => ({
    myId: '',
    started: false,
    stage: 'lobby' as GameStage,
    timer: null as number | null,
    isPaused: false,

    roster: [] as RosterPlayer[],
    publicPlayers: [] as PublicPlayer[],

    myCharacteristics: [] as Characteristic[],
    myBiology: null as Biology | null,

    voteTally: {} as Record<string, number>,
    votedIds: [] as string[],
    myVote: '' as string,
    lastResult: null as VoteResultPayload | null,

    error: '' as string,
  }),

  getters: {
    isHost: (state) => state.roster.length > 0 && state.roster[0].id === state.myId,
    isVoting: (state) => state.stage === 'vote1' || state.stage === 'vote2',
    amAlive: (state) => state.roster.find((p) => p.id === state.myId)?.isAlive ?? true,
  },

  actions: {
    /** Подключается к лобби и навешивает обработчики серверных событий. */
    connect(name: string, lobbyCode: string) {
      const socket = connectSocket(name, lobbyCode)
      this.$reset()

      socket.on('connect', () => {
        this.myId = socket.id ?? ''
      })

      socket.on('updatePlayers', (players) => {
        this.roster = players
      })

      socket.on('gameStarted', (payload) => {
        this.started = true
        this.stage = payload.stage
        this.publicPlayers = payload.players
      })

      socket.on('yourCharacteristics', (payload) => {
        this.myCharacteristics = payload.characteristics
        this.myBiology = payload.biology
      })

      socket.on('charactersUpdated', (payload) => {
        this.publicPlayers = payload.players
      })

      socket.on('stageChanged', (payload) => {
        this.stage = payload.stage
        this.timer = payload.timer
        this.isPaused = payload.isPaused
        this.myVote = ''
      })

      socket.on('timerTick', (payload) => {
        this.timer = payload.timer
        this.isPaused = payload.isPaused
      })

      socket.on('timerPaused', (payload) => {
        this.timer = payload.timer
        this.isPaused = true
      })

      socket.on('timerResumed', (payload) => {
        this.timer = payload.timer
        this.isPaused = false
      })

      socket.on('votesUpdated', (payload) => {
        this.voteTally = payload.tally
        this.votedIds = payload.voted
      })

      socket.on('voteResult', (payload) => {
        this.lastResult = payload
      })

      socket.on('errorMessage', (payload) => {
        this.error = payload.message
      })
    },

    // ── Действия игрока (эмиты на сервер) ──
    startGame() {
      getSocket()?.emit('startGame')
    },
    reveal(characteristicType: Characteristic['type'] | 'Биология') {
      getSocket()?.emit('revealCharacteristic', { characteristicType })
    },
    vote(targetId: string) {
      this.myVote = targetId
      getSocket()?.emit('vote', { targetId })
    },
    resolveVote() {
      getSocket()?.emit('resolveVote')
    },
    togglePause() {
      getSocket()?.emit(this.isPaused ? 'resumeGame' : 'pauseGame')
    },
    resetTimer(timerValue?: number) {
      getSocket()?.emit('resetTimer', { timerValue })
    },
    nextStage(timerValue?: number) {
      getSocket()?.emit('nextStage', { timerValue })
    },
  },
})

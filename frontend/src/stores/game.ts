import { defineStore } from 'pinia'
import type {
  ActionCard,
  Biology,
  BunkerState,
  Characteristic,
  GameStage,
  LobbySettings,
  PublicPlayer,
  TurnState,
  VoteResultPayload,
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { connectSocket, getSocket, type JoinMode } from '@/services/socket'

interface RosterPlayer {
  id: string
  name: string
  isAlive: boolean
  connected: boolean
}

/**
 * Единый стор игры: состояние комнаты, свои характеристики, стадия/таймер,
 * ходы и голосование. Всё обновляется по событиям сервера (сервер — источник правды).
 * Идентификатор игрока (`myId`) стабильный — приходит в событии `welcome`.
 */
export const useGameStore = defineStore('game', {
  state: () => ({
    myId: '',
    hostFlag: false,
    started: false,
    stage: 'lobby' as GameStage,
    timer: null as number | null,
    isPaused: false,

    settings: { ...DEFAULT_SETTINGS } as LobbySettings,

    turn: {
      currentPlayerId: null,
      round: 0,
      revealsThisTurn: 0,
      revealedThisTurn: 0,
      currentVoterId: null,
    } as TurnState,

    bunker: { catastrophe: '', years: 0, threats: [] } as BunkerState,
    actionCards: [] as ActionCard[],

    roster: [] as RosterPlayer[],
    publicPlayers: [] as PublicPlayer[],

    myCharacteristics: [] as Characteristic[],
    myBiology: null as Biology | null,

    voteTally: {} as Record<string, number>,
    votedIds: [] as string[],
    votesByTarget: {} as Record<string, string[]>,
    myVote: '' as string,
    lastResult: null as VoteResultPayload | null,

    survivorIds: [] as string[],

    error: '' as string,
  }),

  getters: {
    isHost: (state) => state.hostFlag,
    isVoting: (state) => state.stage === 'vote1' || state.stage === 'vote2',
    isEnded: (state) => state.stage === 'end',
    amAlive: (state) => state.roster.find((p) => p.id === state.myId)?.isAlive ?? true,
    isReview: (state) => state.stage === 'review',
    isMyTurn: (state) => state.stage === 'reveal' && state.turn.currentPlayerId === state.myId,
    isMyVoteTurn: (state) =>
      (state.stage === 'vote1' || state.stage === 'vote2') &&
      state.settings.voteMode === 'sequential' &&
      state.turn.currentVoterId === state.myId,
    currentPlayerName: (state) => {
      const id = state.turn.currentPlayerId
      return id ? (state.roster.find((p) => p.id === id)?.name ?? '') : ''
    },
    currentVoterName: (state) => {
      const id = state.turn.currentVoterId
      return id ? (state.roster.find((p) => p.id === id)?.name ?? '') : ''
    },
    revealsLeftThisTurn: (state) =>
      Math.max(0, state.turn.revealsThisTurn - state.turn.revealedThisTurn),
    amSurvivor: (state) => state.survivorIds.includes(state.myId),
  },

  actions: {
    /** Подключается к лобби и навешивает обработчики серверных событий. */
    connect(name: string, lobbyCode: string, mode: JoinMode) {
      this.$reset()
      const socket = connectSocket(name, lobbyCode, mode)

      socket.on('welcome', (payload) => {
        this.myId = payload.playerId
        this.hostFlag = payload.isHost
        this.settings = payload.settings
        this.error = ''
      })

      socket.on('updatePlayers', (players) => {
        this.roster = players
      })

      socket.on('settingsUpdated', (payload) => {
        this.settings = payload.settings
      })

      socket.on('gameStarted', (payload) => {
        this.started = true
        this.stage = payload.stage
        this.publicPlayers = payload.players
        this.settings = payload.settings
        this.turn = payload.turn
        this.bunker = payload.bunker
        this.actionCards = payload.actionCards
        this.lastResult = null
        this.survivorIds = []
      })

      socket.on('bunkerUpdated', (payload) => {
        this.bunker = payload.bunker
      })

      socket.on('newGameStarted', () => {
        // Сброс к лобби, но сохраняем подключение/идентичность.
        this.started = false
        this.stage = 'lobby'
        this.publicPlayers = []
        this.myCharacteristics = []
        this.myBiology = null
        this.turn = { currentPlayerId: null, round: 0, revealsThisTurn: 0, revealedThisTurn: 0, currentVoterId: null }
        this.voteTally = {}
        this.votedIds = []
        this.votesByTarget = {}
        this.myVote = ''
        this.lastResult = null
        this.survivorIds = []
        this.bunker = { catastrophe: '', years: 0, threats: [] }
        this.actionCards = []
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
        this.turn = payload.turn
        this.myVote = ''
      })

      socket.on('turnChanged', (payload) => {
        this.turn = payload.turn
        this.timer = payload.timer
        this.isPaused = payload.isPaused
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
        this.votesByTarget = payload.votesByTarget
      })

      socket.on('voteResult', (payload) => {
        this.lastResult = payload
      })

      socket.on('gameEnded', (payload) => {
        this.stage = 'end'
        this.survivorIds = payload.survivorIds
        this.publicPlayers = payload.players
      })

      socket.on('errorMessage', (payload) => {
        this.error = payload.message
      })
    },

    // ── Действия хоста (настройки) ──
    updateSettings(partial: Partial<LobbySettings>) {
      const next = { ...this.settings, ...partial }
      getSocket()?.emit('updateSettings', { settings: next })
    },

    // ── Действия игрока (эмиты на сервер) ──
    startGame() {
      getSocket()?.emit('startGame')
    },
    beginRounds() {
      getSocket()?.emit('beginRounds')
    },
    newGame() {
      getSocket()?.emit('newGame')
    },
    reveal(characteristicType: Characteristic['type'] | 'Биология') {
      getSocket()?.emit('revealCharacteristic', { characteristicType })
    },
    endTurn() {
      getSocket()?.emit('endTurn')
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
    resetTimer() {
      getSocket()?.emit('resetTimer', {})
    },
  },
})

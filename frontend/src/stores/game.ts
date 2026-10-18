import { defineStore } from 'pinia'
import type {
  ActionCard,
  Biology,
  BunkerState,
  CardPlayedPayload,
  RerollAnimationSlot,
  CardHistoryEntry,
  CardTargets,
  CatalogCard,
  CharSlot,
  Characteristic,
  GameStage,
  LobbySettings,
  PublicPlayer,
  SurvivalReport,
  TurnState,
  VoteResultPayload,
  PublicBunkerChallenge,
} from '@shared/types'
import { DEFAULT_SETTINGS, EMPTY_BUNKER } from '@shared/types'
import { connectSocket, disconnectSocket, getSocket, type JoinMode } from '@/services/socket'

interface RosterPlayer {
  id: string
  avatarUrl?: string
  name: string
  isAlive: boolean
  connected: boolean
}

let cardPopupTimer: number | null = null
const effectTimers = new Map<string, number>()

function clearCardPopupTimer() {
  if (cardPopupTimer === null) return
  window.clearTimeout(cardPopupTimer)
  cardPopupTimer = null
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
      stepIndex: 0,
      round: 0,
      revealsThisTurn: 0,
      revealedThisTurn: 0,
      currentVoterId: null,
    } as TurnState,

    bunker: { ...EMPTY_BUNKER } as BunkerState,
    charLayout: [] as CharSlot[],
    actionCards: [] as ActionCard[],
    myCards: [] as ActionCard[],
    cardPopup: null as CardPlayedPayload | null,
    cardPopupQueue: [] as CardPlayedPayload[],
    closingCardPopup: null as CardPlayedPayload | null,
    rerollSlots: {} as Record<string, { seq: number; slot: RerollAnimationSlot; index: number; spinning: boolean }>,
    bloodPlayers: {} as Record<string, number>,
    cardHistory: [] as CardHistoryEntry[],
    threatPopup: null as PublicBunkerChallenge | null,
    catalog: [] as CatalogCard[],

    roster: [] as RosterPlayer[],
    publicPlayers: [] as PublicPlayer[],

    myCharacteristics: [] as Characteristic[],
    myBiology: null as Biology | null,
    forcedReveal: null as { category: string; occ: number } | null,

    voteTally: {} as Record<string, number>,
    votedIds: [] as string[],
    voteCandidates: null as string[] | null,
    votesByTarget: {} as Record<string, string[]>,
    revoteFrom: {} as Record<string, string>,
    myVote: '' as string,
    lastResult: null as VoteResultPayload | null,

    survivorIds: [] as string[],
    survival: null as SurvivalReport | null,
    autoEndTurn: false,

    error: '' as string,
    kicked: false,
  }),

  getters: {
    isHost: (state) => state.hostFlag,
    isVoting: (state) => state.stage === 'vote1' || state.stage === 'vote2',
    isEnded: (state) => state.stage === 'end',
    amAlive: (state) => state.roster.find((p) => p.id === state.myId)?.isAlive ?? true,
    isReview: (state) => state.stage === 'review',
    playableCards: (state) =>
      state.myCards.filter((c) => {
        if (c.used) return false
        if (c.stage === 'any') return true
        if (c.stage === 'reveal') return state.stage === 'reveal'
        if (c.stage === 'vote') return state.stage === 'vote1' || state.stage === 'vote2'
        return false
      }),
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
    kickPlayer(playerId: string) {
      getSocket()?.emit('kickPlayer', { playerId })
    },
    /** Подключается к лобби и навешивает обработчики серверных событий. */
    connect(name: string, lobbyCode: string, mode: JoinMode) {
      this.clearCardEffects()
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
      socket.on('connect_error', (error) => {
        this.error = error.message || 'Не удалось подключиться к серверу'
      })

      socket.on('kicked', (payload) => {
        this.clearCardEffects()
        disconnectSocket()
        this.$reset()
        this.kicked = true
        this.error = payload.message
      })

      socket.on('settingsUpdated', (payload) => {
        this.settings = payload.settings
      })

      socket.on('gameStarted', (payload) => {
        this.clearCardEffects()
        this.started = true
        this.stage = payload.stage
        this.publicPlayers = payload.players
        this.settings = payload.settings
        this.turn = payload.turn
        this.bunker = payload.bunker
        this.charLayout = payload.charLayout ?? []
        this.actionCards = payload.actionCards
        this.cardHistory = payload.cardHistory ?? []
        this.lastResult = null
        this.survivorIds = []
        this.survival = null
      })

      socket.on('bunkerUpdated', (payload) => {
        const previous = new Map<string, number>()
        for (const threat of this.bunker.threats) {
          previous.set(threat.flavor, (previous.get(threat.flavor) ?? 0) + 1)
        }
        const added = payload.bunker.threats.filter((threat) => {
          const count = previous.get(threat.flavor) ?? 0
          if (count === 0) return true
          previous.set(threat.flavor, count - 1)
          return false
        })
        if (added.length > 0) this.threatPopup = added[added.length - 1] ?? null
        this.bunker = payload.bunker
      })

      socket.on('yourCards', (payload) => {
        this.myCards = payload.cards
      })

      socket.on('cardCatalog', (payload) => {
        this.catalog = payload.cards
      })

      socket.on('cardPlayed', (payload) => {
        this.startCardEffects(payload)
        this.cardPopupQueue.push(payload)
        this.showNextCardPopup()
      })

      socket.on('cardHistoryUpdated', (payload) => {
        this.cardHistory = payload.cardHistory
      })

      socket.on('newGameStarted', () => {
        this.clearCardEffects()
        // Сброс к лобби, но сохраняем подключение/идентичность.
        this.started = false
        this.stage = 'lobby'
        this.publicPlayers = []
        this.myCards = []
        this.cardPopup = null
        this.threatPopup = null
        this.myCharacteristics = []
        this.myBiology = null
        this.forcedReveal = null
        this.turn = { currentPlayerId: null, stepIndex: 0, round: 0, revealsThisTurn: 0, revealedThisTurn: 0, currentVoterId: null }
        this.voteTally = {}
        this.votedIds = []
        this.votesByTarget = {}
        this.myVote = ''
        this.lastResult = null
        this.survivorIds = []
        this.survival = null
        this.bunker = { ...EMPTY_BUNKER, catastrophe: { flavor: '', requirements: [] } }
        this.charLayout = []
        this.actionCards = []
        this.cardHistory = []
        this.revoteFrom = {}
      })

      socket.on('yourCharacteristics', (payload) => {
        this.myCharacteristics = payload.characteristics
        this.myBiology = payload.biology
      })
      socket.on('forcedRevealChanged', ({ slot }) => { this.forcedReveal = slot })

      socket.on('charactersUpdated', (payload) => {
        this.publicPlayers = payload.players
        const me = payload.players.find((p) => p.id === this.myId)
        if (!me) return
        for (const vis of me.characteristics) {
          const mine = this.myCharacteristics.find(
            (c) => c.type === vis.type && (c.occ ?? 0) === (vis.occ ?? 0),
          )
          if (mine) {
            mine.isVisible = true
            mine.value = vis.value
            mine.coef = vis.coef
            mine.hint = vis.hint
            mine.tags = vis.tags
            mine.stageLabel = vis.stageLabel
            mine.stageIndex = vis.stageIndex
            mine.incurable = vis.incurable
          }
        }
        if (me.biology && this.myBiology) {
          this.myBiology.isVisible = true
          Object.assign(this.myBiology, me.biology)
        }
      })

      socket.on('stageChanged', (payload) => {
        if (payload.stage !== 'vote2') this.voteCandidates = null
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
        this.voteCandidates = payload.candidates ?? null
        this.voteTally = payload.tally
        this.votedIds = payload.voted
        this.votesByTarget = payload.votesByTarget
        this.revoteFrom = payload.revoteFrom ?? {}
        this.myVote = payload.ownVote ?? ''
      })

      socket.on('voteResult', (payload) => {
        this.lastResult = payload
      })

      socket.on('gameEnded', (payload) => {
        this.clearCardEffects()
        this.stage = 'end'
        this.survivorIds = payload.survivorIds
        this.publicPlayers = payload.players
        this.survival = payload.survival
      })

      socket.on('errorMessage', (payload) => {
        this.error = payload.message
        window.setTimeout(() => {
          if (this.error === payload.message) this.error = ''
        }, 5000)
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
    playCard(instanceId: string, targets: CardTargets) {
      getSocket()?.emit('playCard', { instanceId, targets })
    },
    adminGiveCard(cardId: string) {
      getSocket()?.emit('adminGiveCard', { cardId })
    },
    requestCatalog() {
      getSocket()?.emit('requestCatalog')
    },
    clearCardEffects() {
      clearCardPopupTimer()
      effectTimers.forEach(timer => window.clearTimeout(timer))
      effectTimers.clear()
      this.cardPopup = null
      this.cardPopupQueue = []
      this.closingCardPopup = null
      this.rerollSlots = {}
      this.bloodPlayers = {}
    },
    showNextCardPopup() {
      if (this.cardPopup || this.closingCardPopup) return
      this.cardPopup = this.cardPopupQueue.shift() ?? null
      if (this.cardPopup) cardPopupTimer = window.setTimeout(() => this.dismissCardPopup(), 8_000)
    },
    dismissCardPopup() {
      if (!this.cardPopup) return
      clearCardPopupTimer()
      this.closingCardPopup = this.cardPopup
      this.cardPopup = null
    },
    /** Called after the popup's leave transition, for both a click and the 8-second timeout. */
    onCardPopupClosed() {
      const closed = this.closingCardPopup
      if (!closed) return
      this.closingCardPopup = null
      this.showNextCardPopup()
    },
    startCardEffects(payload: CardPlayedPayload) {
      payload.reroll?.forEach((slot, index) => {
        const key = `${slot.playerId}:${slot.category}#${slot.occ}`
        window.clearTimeout(effectTimers.get(key))
        this.rerollSlots[key] = { seq: payload.seq, slot, index, spinning: true }
        effectTimers.set(key, window.setTimeout(() => this.finishRerollSlot(payload.seq, key), 5_000))
      })
      payload.bloodPlayerIds?.forEach(id => {
        const key = `blood:${id}`
        window.clearTimeout(effectTimers.get(key))
        this.bloodPlayers[id] = payload.seq
        effectTimers.set(key, window.setTimeout(() => {
          if (this.bloodPlayers[id] === payload.seq) delete this.bloodPlayers[id]
          effectTimers.delete(key)
        }, 7_000))
      })
    },
    finishRerollSlot(seq: number, key: string) {
      if (this.rerollSlots[key]?.seq !== seq) return
      window.clearTimeout(effectTimers.get(key))
      effectTimers.delete(key)
      delete this.rerollSlots[key]
    },
    finishReroll(seq: number) {
      Object.keys(this.rerollSlots).forEach(key => this.finishRerollSlot(seq, key))
    },
    dismissThreatPopup() {
      this.threatPopup = null
    },
    newGame() {
      getSocket()?.emit('newGame')
    },
    reveal(characteristicType: Characteristic['type'] | 'Биология', occ = 0) {
      getSocket()?.emit('revealCharacteristic', {
        characteristicType,
        occ,
        autoEndTurn: this.autoEndTurn,
      })
    },
    endTurn() {
      getSocket()?.emit('endTurn')
    },
    vote(targetId: string) {
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

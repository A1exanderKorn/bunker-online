import type { Server } from 'socket.io'
import type {
  ActionCard,
  BunkerState,
  ClientToServerEvents,
  GameStage,
  LobbySettings,
  Player,
  PublicPlayer,
  RoundStep,
  ServerToClientEvents,
  TurnState,
} from '../shared/types'
import {
  BIOLOGY_CATEGORY,
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  defaultRoundSteps,
} from '../shared/types'
import { MAX_PLAYERS, MIN_PLAYERS, RECONNECT_GRACE_MS, TURN_GRACE_SECONDS } from './config'
import { dealCharacteristics } from './characteristics'
import { pickCatastrophe, threatQueue } from './bunker'

type IO = Server<ClientToServerEvents, ServerToClientEvents>

const EMPTY_TURN: TurnState = {
  currentPlayerId: null,
  round: 0,
  revealsThisTurn: 0,
  revealedThisTurn: 0,
  currentVoterId: null,
}

/**
 * Одна игровая комната: состояние, серверный таймер, механика ходов по
 * программе раундов, вскрытие характеристик, голосование (одновременное и
 * поочерёдное), угрозы/катастрофа и условие победы.
 *
 * Игрок идентифицируется стабильным `playerId` (не socket.id) — это позволяет
 * переподключаться без потери места в игре.
 */
export class Lobby {
  readonly code: string
  private io: IO
  players: Player[] = []
  stage: GameStage = 'lobby'
  started = false
  settings: LobbySettings = this.freshSettings()

  private sockets = new Map<string, string>()
  private removalTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private timer = 0
  private isPaused = false
  private interval: ReturnType<typeof setInterval> | null = null
  private onTimerExpire: (() => void) | null = null

  // ── Программа раундов ──
  private stepIndex = 0
  private startCount = 0

  // ── Состояние ходов ──
  private turn: TurnState = { ...EMPTY_TURN }
  private turnOrder: string[] = []
  private turnIndex = 0
  private turnGraceGiven = false

  // ── Голосование ──
  private votes = new Map<string, string>()
  private voteCandidates: string[] | null = null

  // ── Бункер ──
  private bunker: BunkerState = { catastrophe: '', years: 0, threats: [] }
  private pendingThreats: string[] = []

  constructor(io: IO, code: string) {
    this.io = io
    this.code = code
  }

  private freshSettings(): LobbySettings {
    return {
      ...DEFAULT_SETTINGS,
      roundSteps: defaultRoundSteps(2, 1),
    }
  }

  // ─── Игроки ────────────────────────────────────────────────────────────

  get host(): Player | undefined {
    return this.players[0]
  }
  isHost(playerId: string): boolean {
    return this.host?.id === playerId
  }
  isEmpty(): boolean {
    return this.players.length === 0
  }
  socketOf(playerId: string): string | undefined {
    return this.sockets.get(playerId)
  }

  addOrReconnect(socketId: string, name: string): string | null {
    const existing = this.players.find((p) => p.name === name && !p.connected)
    if (existing) {
      const pending = this.removalTimers.get(existing.id)
      if (pending) {
        clearTimeout(pending)
        this.removalTimers.delete(existing.id)
      }
      existing.connected = true
      this.sockets.set(existing.id, socketId)
      this.broadcastPlayers()
      return existing.id
    }

    if (this.started) return null
    if (this.players.length >= MAX_PLAYERS) return null
    if (this.players.some((p) => p.name === name)) return null

    const playerId = `p_${Math.random().toString(36).slice(2, 10)}`
    this.players.push({
      id: playerId,
      name,
      characteristics: [],
      biology: null,
      isAlive: true,
      connected: true,
    })
    this.sockets.set(playerId, socketId)
    // Пересчитываем программу по умолчанию под новое число игроков (до старта).
    this.regenerateDefaultSteps()
    this.broadcastPlayers()
    this.io.to(this.code).emit('settingsUpdated', { settings: this.settings })
    return playerId
  }

  handleDisconnect(playerId: string): void {
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return
    this.sockets.delete(playerId)

    if (!this.started) {
      this.removePlayerNow(playerId)
      return
    }
    player.connected = false
    this.broadcastPlayers()
    const t = setTimeout(() => this.removePlayerNow(playerId), RECONNECT_GRACE_MS)
    this.removalTimers.set(playerId, t)
  }

  private removePlayerNow(playerId: string): void {
    const wasCurrent = this.turn.currentPlayerId === playerId
    const wasVoter = this.turn.currentVoterId === playerId
    this.players = this.players.filter((p) => p.id !== playerId)
    this.sockets.delete(playerId)
    this.votes.delete(playerId)
    this.turnOrder = this.turnOrder.filter((id) => id !== playerId)
    const rt = this.removalTimers.get(playerId)
    if (rt) {
      clearTimeout(rt)
      this.removalTimers.delete(playerId)
    }
    if (this.isEmpty()) return

    if (!this.started) this.regenerateDefaultSteps()
    this.broadcastPlayers()
    if (!this.started) {
      this.io.to(this.code).emit('settingsUpdated', { settings: this.settings })
      return
    }

    if (this.stage !== 'end') {
      if (this.stage === 'reveal' && wasCurrent) this.advanceTurn()
      if (this.isVoting()) {
        if (this.settings.voteMode === 'sequential' && wasVoter) this.advanceVoter()
        else this.broadcastVotes()
      }
      this.checkWinCondition()
    }
  }

  private broadcastPlayers(): void {
    this.io.to(this.code).emit(
      'updatePlayers',
      this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isAlive: p.isAlive,
        connected: p.connected,
      })),
    )
  }

  // ─── Настройки ─────────────────────────────────────────────────────────

  updateSettings(playerId: string, incoming: Partial<LobbySettings>): void {
    if (!this.isHost(playerId)) return
    if (this.started) return
    this.settings = this.sanitizeSettings({ ...this.settings, ...incoming })
    this.io.to(this.code).emit('settingsUpdated', { settings: this.settings })
  }

  /** Пересобирает программу по умолчанию (если хост её не трогал вручную). */
  private regenerateDefaultSteps(): void {
    const survivors = this.survivorsTarget(this.players.length)
    this.settings.roundSteps = defaultRoundSteps(this.players.length, survivors)
  }

  private sanitizeSettings(s: LobbySettings): LobbySettings {
    const L = SETTINGS_LIMITS
    const clampNum = (v: number, min: number, max: number, fb: number) =>
      Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb
    const steps = Array.isArray(s.roundSteps) ? s.roundSteps : []
    const cleanSteps: RoundStep[] = steps.slice(0, L.maxSteps).map((step) => ({
      kind: step.kind === 'vote' ? 'vote' : 'reveal',
      revealThreat: step.kind === 'reveal' ? !!step.revealThreat : false,
    }))
    return {
      turnSeconds: Math.round(
        clampNum(s.turnSeconds, L.turnSeconds.min, L.turnSeconds.max, DEFAULT_SETTINGS.turnSeconds),
      ),
      voteSeconds: Math.round(
        clampNum(s.voteSeconds, L.voteSeconds.min, L.voteSeconds.max, DEFAULT_SETTINGS.voteSeconds),
      ),
      sequentialVoteSeconds: Math.round(
        clampNum(
          s.sequentialVoteSeconds,
          L.sequentialVoteSeconds.min,
          L.sequentialVoteSeconds.max,
          DEFAULT_SETTINGS.sequentialVoteSeconds,
        ),
      ),
      targetCoef: clampNum(s.targetCoef, L.targetCoef.min, L.targetCoef.max, DEFAULT_SETTINGS.targetCoef),
      survivorsCount: Math.round(
        clampNum(s.survivorsCount, L.survivorsCount.min, L.survivorsCount.max, DEFAULT_SETTINGS.survivorsCount),
      ),
      voteMode: s.voteMode === 'sequential' ? 'sequential' : 'simultaneous',
      extraBaggage: !!s.extraBaggage,
      noPhobias: !!s.noPhobias,
      threatsEnabled: !!s.threatsEnabled,
      roundSteps: cleanSteps.length > 0 ? cleanSteps : defaultRoundSteps(this.players.length, this.survivorsTarget(this.players.length)),
    }
  }

  private survivorsTarget(startCount: number): number {
    if (this.settings.survivorsCount > 0) return Math.min(this.settings.survivorsCount, startCount)
    return Math.ceil(startCount / 2)
  }

  // ─── Старт игры ────────────────────────────────────────────────────────

  start(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    if (this.started) return
    if (this.players.length < MIN_PLAYERS) {
      this.emitError(requesterId, `Нужно минимум ${MIN_PLAYERS} игрока для старта`)
      return
    }

    dealCharacteristics(this.players, {
      targetCoef: this.settings.targetCoef,
      extraBaggage: this.settings.extraBaggage,
      noPhobias: this.settings.noPhobias,
    })
    this.started = true
    this.startCount = this.players.length
    this.stepIndex = 0

    // Бункер: катастрофа + случайные годы (1–15) + очередь угроз под помеченные шаги.
    const threatSteps = this.settings.threatsEnabled
      ? this.settings.roundSteps.filter((s) => s.kind === 'reveal' && s.revealThreat).length
      : 0
    this.pendingThreats = threatQueue(threatSteps)
    this.bunker = {
      catastrophe: pickCatastrophe(),
      years: 1 + Math.floor(Math.random() * 15),
      threats: [],
    }

    for (const player of this.players) {
      if (!player.biology) continue
      const sid = this.sockets.get(player.id)
      if (sid) {
        this.io.to(sid).emit('yourCharacteristics', {
          characteristics: player.characteristics,
          biology: player.biology,
        })
      }
    }

    // П.1: сначала стадия ознакомления — все видят свои характеристики, раунды не идут.
    this.stage = 'review'
    this.turn = { ...EMPTY_TURN }
    this.io.to(this.code).emit('gameStarted', {
      players: this.publicPlayers(),
      stage: this.stage,
      settings: this.settings,
      turn: this.turn,
      bunker: this.bunker,
      actionCards: this.actionCardsStub(),
    })
  }

  /** П.1: хост начинает раунды вскрытия после ознакомления. */
  beginRounds(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    if (this.stage !== 'review') return
    this.stepIndex = 0
    this.runStep(0)
  }

  /**
   * П.8: новая игра — все возвращаются в лобби, хост тот же, порядок игроков тасуется.
   */
  newGame(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    this.stopTimer()
    const host = this.host
    // Тасуем остальных, хост остаётся players[0].
    const rest = this.players.filter((p) => p.id !== host?.id)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    this.players = host ? [host, ...rest] : rest
    // Сброс игрового состояния.
    for (const p of this.players) {
      p.isAlive = true
      p.characteristics = []
      p.biology = null
    }
    this.started = false
    this.stage = 'lobby'
    this.turn = { ...EMPTY_TURN }
    this.votes.clear()
    this.voteCandidates = null
    this.bunker = { catastrophe: '', years: 0, threats: [] }
    this.pendingThreats = []
    this.stepIndex = 0
    this.regenerateDefaultSteps()
    this.broadcastPlayers()
    this.io.to(this.code).emit('settingsUpdated', { settings: this.settings })
    this.io.to(this.code).emit('newGameStarted', {})
  }

  /** Заглушка карт действия (функционал добавится позже). */
  private actionCardsStub(): ActionCard[] {
    return []
  }

  // ─── Исполнение программы раундов ────────────────────────────────────────

  private runStep(index: number): void {
    // П.7: программа кончилась — игра завершается (без принудительного повтора).
    if (index >= this.settings.roundSteps.length) {
      this.endGame()
      return
    }
    const step = this.settings.roundSteps[index]
    this.stepIndex = index
    if (step.kind === 'reveal') {
      if (step.revealThreat && this.settings.threatsEnabled) this.revealNextThreat()
      this.beginRevealStep(step)
    } else {
      this.startVote()
    }
  }

  private nextStep(): void {
    this.runStep(this.stepIndex + 1)
  }

  private revealNextThreat(): void {
    const threat = this.pendingThreats.shift()
    if (!threat) return
    this.bunker.threats.push(threat)
    this.io.to(this.code).emit('bunkerUpdated', { bunker: this.bunker })
  }

  // ─── Раунд вскрытия и ходы ──────────────────────────────────────────────

  private roundNumber(): number {
    // Номер раунда = сколько reveal-шагов было до текущего включительно.
    let n = 0
    for (let i = 0; i <= this.stepIndex && i < this.settings.roundSteps.length; i++) {
      if (this.settings.roundSteps[i].kind === 'reveal') n++
    }
    return n
  }

  private beginRevealStep(step: RoundStep): void {
    this.stage = 'reveal'
    this.turnOrder = this.alive().map((p) => p.id)
    this.turnIndex = 0
    this.turn = {
      currentPlayerId: null,
      round: this.roundNumber(),
      revealsThisTurn: 1, // reveal-шаг = ровно 1 характеристика
      revealedThisTurn: 0,
      currentVoterId: null,
    }
    this.io.to(this.code).emit('stageChanged', {
      stage: this.stage,
      timer: 0,
      isPaused: this.isPaused,
      turn: this.turn,
    })
    if (this.turnOrder.length === 0) {
      this.nextStep()
      return
    }
    this.startTurn(0)
  }

  private startTurn(index: number): void {
    this.turnIndex = index
    const playerId = this.turnOrder[index]
    this.turnGraceGiven = false
    this.turn = { ...this.turn, currentPlayerId: playerId, revealedThisTurn: 0 }
    this.startTimer(this.settings.turnSeconds, () => this.onTurnTimeout())
    this.io.to(this.code).emit('turnChanged', {
      turn: this.turn,
      timer: this.timer,
      isPaused: this.isPaused,
    })
  }

  private onTurnTimeout(): void {
    if (this.stage !== 'reveal') return
    const playerId = this.turn.currentPlayerId
    if (!playerId) return

    if (this.turn.revealedThisTurn < this.turn.revealsThisTurn && !this.turnGraceGiven) {
      const revealed = this.revealRandomFor(playerId)
      if (revealed) {
        this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })
        this.io.to(this.code).emit('turnChanged', {
          turn: this.turn,
          timer: this.timer,
          isPaused: this.isPaused,
        })
      }
      if (this.turn.revealedThisTurn < this.turn.revealsThisTurn) {
        this.turnGraceGiven = true
        this.startTimer(TURN_GRACE_SECONDS, () => this.onTurnTimeout())
        this.io.to(this.code).emit('turnChanged', {
          turn: this.turn,
          timer: this.timer,
          isPaused: this.isPaused,
        })
        return
      }
    }
    this.advanceTurn()
  }

  private revealRandomFor(playerId: string): boolean {
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return false
    const hidden = player.characteristics.filter((c) => !c.isVisible)
    const bioHidden = player.biology && !player.biology.isVisible
    const total = hidden.length + (bioHidden ? 1 : 0)
    if (total === 0) return false
    let pick = Math.floor(Math.random() * total)
    if (bioHidden && pick === hidden.length) {
      player.biology!.isVisible = true
    } else {
      hidden[pick].isVisible = true
    }
    this.turn.revealedThisTurn += 1
    return true
  }

  private advanceTurn(): void {
    if (this.stage !== 'reveal') return
    const next = this.turnIndex + 1
    if (next >= this.turnOrder.length) {
      this.stopTimer()
      this.nextStep()
      return
    }
    this.startTurn(next)
  }

  endTurn(playerId: string): void {
    if (this.stage !== 'reveal') return
    if (this.turn.currentPlayerId !== playerId) return
    if (this.turn.revealedThisTurn < 1) {
      this.emitError(playerId, 'Нужно вскрыть хотя бы одну характеристику, прежде чем завершить ход')
      return
    }
    this.advanceTurn()
  }

  // ─── Вскрытие характеристик ──────────────────────────────────────────────

  reveal(playerId: string, type: string): void {
    if (this.stage !== 'reveal') return
    if (this.turn.currentPlayerId !== playerId) return
    if (this.turn.revealedThisTurn >= this.turn.revealsThisTurn) return

    const player = this.players.find((p) => p.id === playerId)
    if (!player) return

    let ok = false
    if (type === BIOLOGY_CATEGORY) {
      if (player.biology && !player.biology.isVisible) {
        player.biology.isVisible = true
        ok = true
      }
    } else {
      const char = player.characteristics.find((c) => c.type === type && !c.isVisible)
      if (char) {
        char.isVisible = true
        ok = true
      }
    }
    if (!ok) return

    this.turn.revealedThisTurn += 1
    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })
    this.io.to(this.code).emit('turnChanged', {
      turn: this.turn,
      timer: this.timer,
      isPaused: this.isPaused,
    })
    // П.2: ход НЕ завершается автоматически после вскрытия —
    // только по кнопке «Завершить ход» или по истечении таймера.
  }

  // ─── Голосование ──────────────────────────────────────────────────────────

  private isVoting(): boolean {
    return this.stage === 'vote1' || this.stage === 'vote2'
  }
  private alive(): Player[] {
    return this.players.filter((p) => p.isAlive)
  }

  private startVote(): void {
    if (this.checkWinCondition()) return

    this.stage = 'vote1'
    this.votes.clear()
    this.voteCandidates = null
    this.turn = { ...this.turn, currentPlayerId: null, currentVoterId: null }

    if (this.settings.voteMode === 'sequential') {
      this.beginSequentialVote()
      return
    }
    this.startTimer(this.settings.voteSeconds, () => this.onVoteTimeout())
    this.io.to(this.code).emit('stageChanged', {
      stage: this.stage,
      timer: this.timer,
      isPaused: this.isPaused,
      turn: this.turn,
    })
    this.broadcastVotes()
  }

  // Поочерёдное голосование: порядок = порядок ходов (живые игроки).
  private voteOrder: string[] = []
  private voteOrderIndex = 0

  private beginSequentialVote(): void {
    this.voteOrder = this.alive().map((p) => p.id)
    this.voteOrderIndex = 0
    this.io.to(this.code).emit('stageChanged', {
      stage: this.stage,
      timer: 0,
      isPaused: this.isPaused,
      turn: this.turn,
    })
    this.broadcastVotes()
    this.startVoterTurn(0)
  }

  private startVoterTurn(index: number): void {
    this.voteOrderIndex = index
    const voterId = this.voteOrder[index]
    this.turn = { ...this.turn, currentVoterId: voterId }
    this.startTimer(this.settings.sequentialVoteSeconds, () => this.onSequentialVoteTimeout())
    this.io.to(this.code).emit('turnChanged', {
      turn: this.turn,
      timer: this.timer,
      isPaused: this.isPaused,
    })
  }

  private onSequentialVoteTimeout(): void {
    const voterId = this.turn.currentVoterId
    if (!voterId) return
    // Не успел — случайный голос среди допустимых целей.
    if (!this.votes.has(voterId)) {
      const targets = this.candidatePool().filter((p) => p.id !== voterId)
      if (targets.length > 0) {
        this.votes.set(voterId, targets[Math.floor(Math.random() * targets.length)].id)
        this.broadcastVotes()
      }
    }
    this.advanceVoter()
  }

  private advanceVoter(): void {
    if (!this.isVoting() || this.settings.voteMode !== 'sequential') return
    const next = this.voteOrderIndex + 1
    if (next >= this.voteOrder.length) {
      this.stopTimer()
      this.finishVote()
      return
    }
    this.startVoterTurn(next)
  }

  private candidatePool(): Player[] {
    return this.voteCandidates
      ? this.alive().filter((p) => this.voteCandidates!.includes(p.id))
      : this.alive()
  }

  vote(voterId: string, targetId: string): void {
    if (!this.isVoting()) return
    const voter = this.players.find((p) => p.id === voterId)
    const target = this.players.find((p) => p.id === targetId)
    if (!voter?.isAlive || !target?.isAlive) return
    if (voterId === targetId) return
    if (this.voteCandidates && !this.voteCandidates.includes(targetId)) return

    // Поочерёдный режим: голосовать может только текущий голосующий.
    if (this.settings.voteMode === 'sequential') {
      if (this.turn.currentVoterId !== voterId) return
      this.votes.set(voterId, targetId)
      this.broadcastVotes()
      this.advanceVoter() // автозавершение хода после голоса
      return
    }

    this.votes.set(voterId, targetId)
    this.broadcastVotes()
  }

  private tally(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const targetId of this.votes.values()) result[targetId] = (result[targetId] || 0) + 1
    return result
  }
  private votesByTarget(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    for (const [voterId, targetId] of this.votes.entries()) (result[targetId] ??= []).push(voterId)
    return result
  }
  private broadcastVotes(): void {
    this.io.to(this.code).emit('votesUpdated', {
      tally: this.tally(),
      voted: [...this.votes.keys()],
      votesByTarget: this.votesByTarget(),
    })
  }

  private fillRandomVotes(): void {
    const pool = this.candidatePool()
    for (const voter of this.alive()) {
      if (this.votes.has(voter.id)) continue
      const targets = pool.filter((p) => p.id !== voter.id)
      if (targets.length === 0) continue
      this.votes.set(voter.id, targets[Math.floor(Math.random() * targets.length)].id)
    }
  }

  private onVoteTimeout(): void {
    if (!this.isVoting()) return
    this.fillRandomVotes()
    this.broadcastVotes()
    this.finishVote()
  }

  resolveVote(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    if (!this.isVoting()) return
    // В поочерёдном режиме хост тоже может подвести итог досрочно.
    this.finishVote()
  }

  private finishVote(): void {
    if (!this.isVoting()) return
    this.stopTimer()
    this.turn = { ...this.turn, currentVoterId: null }

    const tally = this.tally()
    const entries = Object.entries(tally)

    if (entries.length === 0) {
      this.io.to(this.code).emit('voteResult', { eliminatedId: null, tie: false, tiedIds: [], tally })
      if (this.checkWinCondition()) return
      this.nextStep()
      return
    }

    const max = Math.max(...entries.map(([, c]) => c))
    const leaders = entries.filter(([, c]) => c === max).map(([id]) => id)

    if (leaders.length > 1 && this.stage === 'vote1') {
      this.io.to(this.code).emit('voteResult', { eliminatedId: null, tie: true, tiedIds: leaders, tally })
      this.stage = 'vote2'
      this.votes.clear()
      this.voteCandidates = leaders
      if (this.settings.voteMode === 'sequential') {
        this.io.to(this.code).emit('stageChanged', {
          stage: 'vote2',
          timer: 0,
          isPaused: this.isPaused,
          turn: this.turn,
        })
        this.beginSequentialVote()
      } else {
        this.startTimer(this.settings.voteSeconds, () => this.onVoteTimeout())
        this.io.to(this.code).emit('stageChanged', {
          stage: 'vote2',
          timer: this.timer,
          isPaused: this.isPaused,
          turn: this.turn,
        })
        this.broadcastVotes()
      }
      return
    }

    const eliminatedId = leaders[Math.floor(Math.random() * leaders.length)]
    const eliminated = this.players.find((p) => p.id === eliminatedId)
    if (eliminated) {
      eliminated.isAlive = false
      // III.1: у исключённого раскрываются все характеристики.
      eliminated.characteristics.forEach((c) => (c.isVisible = true))
      if (eliminated.biology) eliminated.biology.isVisible = true
    }

    this.votes.clear()
    this.voteCandidates = null
    this.io.to(this.code).emit('voteResult', { eliminatedId, tie: false, tiedIds: [], tally })
    this.broadcastPlayers()
    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })

    if (this.checkWinCondition()) return
    this.nextStep()
  }

  // ─── Условие победы ────────────────────────────────────────────────────

  private checkWinCondition(): boolean {
    if (this.stage === 'end') return true
    const aliveCount = this.alive().length
    if (aliveCount <= this.survivorsTarget(this.startCount)) {
      this.endGame()
      return true
    }
    return false
  }

  private endGame(): void {
    this.stopTimer()
    this.stage = 'end'
    this.turn = { ...this.turn, currentPlayerId: null, currentVoterId: null }
    // На конце игры раскрываем всё у всех.
    for (const p of this.players) {
      p.characteristics.forEach((c) => (c.isVisible = true))
      if (p.biology) p.biology.isVisible = true
    }
    this.io.to(this.code).emit('gameEnded', {
      survivorIds: this.alive().map((p) => p.id),
      players: this.publicPlayers(),
    })
    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })
    this.io.to(this.code).emit('stageChanged', {
      stage: 'end',
      timer: 0,
      isPaused: false,
      turn: this.turn,
    })
  }

  // ─── Таймер ────────────────────────────────────────────────────────────

  private startTimer(seconds: number, onExpire: (() => void) | null): void {
    this.stopTimer()
    this.timer = seconds
    this.isPaused = false
    this.onTimerExpire = onExpire
    this.interval = setInterval(() => {
      if (this.isPaused) return
      this.timer -= 1
      this.io.to(this.code).emit('timerTick', { timer: this.timer, isPaused: false })
      if (this.timer <= 0) {
        this.stopTimer()
        const cb = this.onTimerExpire
        this.onTimerExpire = null
        if (cb) cb()
      }
    }, 1000)
  }
  private stopTimer(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.onTimerExpire = null
  }

  pause(requesterId: string): void {
    if (!this.isHost(requesterId) || this.isPaused) return
    this.isPaused = true
    this.io.to(this.code).emit('timerPaused', { timer: this.timer, isPaused: true })
  }
  resume(requesterId: string): void {
    if (!this.isHost(requesterId) || !this.isPaused) return
    this.isPaused = false
    this.io.to(this.code).emit('timerResumed', { timer: this.timer, isPaused: false })
  }
  resetTimer(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    if (this.stage === 'reveal') {
      this.startTimer(this.settings.turnSeconds, () => this.onTurnTimeout())
    } else if (this.isVoting()) {
      if (this.settings.voteMode === 'sequential') {
        this.startTimer(this.settings.sequentialVoteSeconds, () => this.onSequentialVoteTimeout())
      } else {
        this.startTimer(this.settings.voteSeconds, () => this.onVoteTimeout())
      }
    } else return
    this.io.to(this.code).emit('timerResumed', { timer: this.timer, isPaused: false })
  }

  // ─── Публичное представление ────────────────────────────────────────────

  private publicPlayers(): PublicPlayer[] {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      isAlive: p.isAlive,
      connected: p.connected,
      characteristics: p.characteristics.filter((c) => c.isVisible),
      biology: p.biology?.isVisible ? p.biology : null,
    }))
  }

  snapshotFor(playerId: string): void {
    const sid = this.sockets.get(playerId)
    if (!sid) return
    this.io.to(sid).emit('welcome', {
      playerId,
      isHost: this.isHost(playerId),
      settings: this.settings,
    })
    this.io.to(sid).emit(
      'updatePlayers',
      this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isAlive: p.isAlive,
        connected: p.connected,
      })),
    )
    this.io.to(sid).emit('settingsUpdated', { settings: this.settings })
    if (!this.started) return

    const player = this.players.find((p) => p.id === playerId)
    if (player?.biology) {
      this.io.to(sid).emit('yourCharacteristics', {
        characteristics: player.characteristics,
        biology: player.biology,
      })
    }
    this.io.to(sid).emit('gameStarted', {
      players: this.publicPlayers(),
      stage: this.stage,
      settings: this.settings,
      turn: this.turn,
      bunker: this.bunker,
      actionCards: this.actionCardsStub(),
    })
    this.io.to(sid).emit('bunkerUpdated', { bunker: this.bunker })
    this.io.to(sid).emit('stageChanged', {
      stage: this.stage,
      timer: this.timer,
      isPaused: this.isPaused,
      turn: this.turn,
    })
    if (this.isVoting()) this.broadcastVotes()
    if (this.stage === 'end') {
      this.io.to(sid).emit('gameEnded', {
        survivorIds: this.alive().map((p) => p.id),
        players: this.publicPlayers(),
      })
    }
  }

  private emitError(playerId: string, message: string): void {
    const sid = this.sockets.get(playerId)
    if (sid) this.io.to(sid).emit('errorMessage', { message })
  }

  dispose(): void {
    this.stopTimer()
    for (const t of this.removalTimers.values()) clearTimeout(t)
    this.removalTimers.clear()
  }
}

/** Реестр всех активных лобби. */
export class LobbyManager {
  private lobbies = new Map<string, Lobby>()
  constructor(private io: IO) {}

  create(code: string): Lobby {
    const lobby = new Lobby(this.io, code)
    this.lobbies.set(code, lobby)
    return lobby
  }
  getOrCreate(code: string): Lobby {
    let lobby = this.lobbies.get(code)
    if (!lobby) lobby = this.create(code)
    return lobby
  }
  get(code: string): Lobby | undefined {
    return this.lobbies.get(code)
  }
  has(code: string): boolean {
    return this.lobbies.has(code)
  }
  remove(code: string): void {
    this.lobbies.get(code)?.dispose()
    this.lobbies.delete(code)
  }
}

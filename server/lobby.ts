import type { Server } from 'socket.io'
import type {
  ClientToServerEvents,
  GameStage,
  LobbySettings,
  Player,
  PublicPlayer,
  ServerToClientEvents,
  TurnState,
} from '../shared/types'
import { BIOLOGY_CATEGORY, DEFAULT_SETTINGS, SETTINGS_LIMITS } from '../shared/types'
import { MAX_PLAYERS, MIN_PLAYERS, RECONNECT_GRACE_MS, REVEAL_ORDER } from './config'
import { dealCharacteristics } from './characteristics'

type IO = Server<ClientToServerEvents, ServerToClientEvents>

/**
 * Одна игровая комната: инкапсулирует состояние, серверный таймер,
 * механику ходов, вскрытие характеристик, голосование и условие победы.
 *
 * Игрок идентифицируется стабильным `playerId` (не socket.id), что позволяет
 * переподключаться без потери места в игре. `socketId` обновляется на реконнекте.
 */
export class Lobby {
  readonly code: string
  private io: IO
  players: Player[] = []
  stage: GameStage = 'lobby'
  started = false
  settings: LobbySettings = { ...DEFAULT_SETTINGS }

  /** playerId -> socketId (актуальный сокет игрока). */
  private sockets = new Map<string, string>()
  /** playerId -> таймер отложенного удаления при дисконнекте. */
  private removalTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private timer = 0
  private isPaused = false
  private interval: ReturnType<typeof setInterval> | null = null

  // ── Состояние ходов ──
  private turn: TurnState = {
    currentPlayerId: null,
    round: 0,
    revealsThisTurn: 0,
    revealedThisTurn: 0,
  }
  /** Порядок ходов (playerId живых игроков), фиксируется на старте раунда. */
  private turnOrder: string[] = []
  private turnIndex = 0

  /** voterId -> targetId */
  private votes = new Map<string, string>()
  /** допустимые цели голосования (null = все живые) */
  private voteCandidates: string[] | null = null

  constructor(io: IO, code: string) {
    this.io = io
    this.code = code
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

  /**
   * Добавляет игрока или переподключает существующего по имени.
   * Возвращает playerId при успехе, либо null при отказе.
   */
  addOrReconnect(socketId: string, name: string): string | null {
    // Реконнект: ищем отключённого игрока с тем же именем.
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

    // Новые игроки не могут войти в уже начатую игру.
    if (this.started) return null
    if (this.players.length >= MAX_PLAYERS) return null
    // Уникальность имени среди подключённых.
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
    this.broadcastPlayers()
    return playerId
  }

  /**
   * Помечает игрока отключённым. До игры — удаляем сразу; во время игры —
   * держим место `RECONNECT_GRACE_MS`, чтобы игрок мог вернуться.
   */
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

    this.broadcastPlayers()

    if (this.started && this.stage !== 'end') {
      // Если выбыл тот, чей был ход — передаём ход дальше.
      if (this.stage === 'reveal' && wasCurrent) {
        this.turnIndex = Math.max(0, this.turnIndex)
        this.advanceTurn()
      }
      if (this.isVoting()) this.broadcastVotes()
      // Мог измениться расклад для условия победы.
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

  private sanitizeSettings(s: LobbySettings): LobbySettings {
    const clamp = (v: number, min: number, max: number, fallback: number) =>
      Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
    const L = SETTINGS_LIMITS
    return {
      turnSeconds: Math.round(
        clamp(s.turnSeconds, L.turnSeconds.min, L.turnSeconds.max, DEFAULT_SETTINGS.turnSeconds),
      ),
      voteSeconds: Math.round(
        clamp(s.voteSeconds, L.voteSeconds.min, L.voteSeconds.max, DEFAULT_SETTINGS.voteSeconds),
      ),
      targetCoef: clamp(s.targetCoef, L.targetCoef.min, L.targetCoef.max, DEFAULT_SETTINGS.targetCoef),
      revealsBeforeFirstVote: Math.round(
        clamp(
          s.revealsBeforeFirstVote,
          L.revealsBeforeFirstVote.min,
          L.revealsBeforeFirstVote.max,
          DEFAULT_SETTINGS.revealsBeforeFirstVote,
        ),
      ),
      revealsPerRound: Math.round(
        clamp(
          s.revealsPerRound,
          L.revealsPerRound.min,
          L.revealsPerRound.max,
          DEFAULT_SETTINGS.revealsPerRound,
        ),
      ),
      survivorsCount: Math.round(
        clamp(
          s.survivorsCount,
          L.survivorsCount.min,
          L.survivorsCount.max,
          DEFAULT_SETTINGS.survivorsCount,
        ),
      ),
    }
  }

  /** Сколько выживших нужно (0 => половина от стартового состава, округление вверх). */
  private survivorsTarget(startCount: number): number {
    if (this.settings.survivorsCount > 0) {
      return Math.min(this.settings.survivorsCount, startCount)
    }
    return Math.ceil(startCount / 2)
  }
  private startCount = 0

  // ─── Старт игры ────────────────────────────────────────────────────────

  start(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    if (this.started) return
    if (this.players.length < MIN_PLAYERS) {
      this.emitError(requesterId, `Нужно минимум ${MIN_PLAYERS} игрока для старта`)
      return
    }

    dealCharacteristics(this.players, this.settings.targetCoef)
    this.started = true
    this.startCount = this.players.length
    this.stage = 'reveal'

    // Каждому — его собственные характеристики (приватно).
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

    this.io.to(this.code).emit('gameStarted', {
      players: this.publicPlayers(),
      stage: this.stage,
      settings: this.settings,
      turn: this.turn,
    })

    this.beginRevealRound(1)
  }

  // ─── Раунды вскрытия и ходы ──────────────────────────────────────────────

  private beginRevealRound(round: number): void {
    this.stage = 'reveal'
    this.turnOrder = this.alive().map((p) => p.id)
    this.turnIndex = 0
    this.turn = {
      currentPlayerId: null,
      round,
      revealsThisTurn:
        round === 1 ? this.settings.revealsBeforeFirstVote : this.settings.revealsPerRound,
      revealedThisTurn: 0,
    }
    if (this.turnOrder.length === 0) {
      this.startVote()
      return
    }
    this.startTurn(0)
  }

  private startTurn(index: number): void {
    this.turnIndex = index
    const playerId = this.turnOrder[index]
    this.turn = {
      ...this.turn,
      currentPlayerId: playerId,
      revealedThisTurn: 0,
    }
    this.startTimer(this.settings.turnSeconds, () => this.advanceTurn())
    this.io.to(this.code).emit('turnChanged', {
      turn: this.turn,
      timer: this.timer,
      isPaused: this.isPaused,
    })
  }

  /** Переходит к следующему ходу; если раунд закончен — запускает голосование. */
  private advanceTurn(): void {
    if (this.stage !== 'reveal') return
    const next = this.turnIndex + 1
    if (next >= this.turnOrder.length) {
      this.startVote()
      return
    }
    this.startTurn(next)
  }

  /** Игрок завершает свой ход досрочно (или после нужного числа вскрытий). */
  endTurn(playerId: string): void {
    if (this.stage !== 'reveal') return
    if (this.turn.currentPlayerId !== playerId) return
    this.advanceTurn()
  }

  // ─── Вскрытие характеристик ──────────────────────────────────────────────

  /** Игрок вскрывает СВОЮ характеристику — только в свой ход. */
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
      const char = player.characteristics.find((c) => c.type === type)
      if (char && !char.isVisible) {
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

    // Вскрыл всё, что положено за ход — автоматически передаём ход.
    if (this.turn.revealedThisTurn >= this.turn.revealsThisTurn) {
      this.advanceTurn()
    }
  }

  // ─── Голосование ──────────────────────────────────────────────────────────

  private isVoting(): boolean {
    return this.stage === 'vote1' || this.stage === 'vote2'
  }

  private startVote(): void {
    // Перед голосованием — проверим, не пора ли завершать игру.
    if (this.checkWinCondition()) return

    this.stage = 'vote1'
    this.votes.clear()
    this.voteCandidates = null
    this.turn = { ...this.turn, currentPlayerId: null }
    this.startTimer(this.settings.voteSeconds, null)
    this.io.to(this.code).emit('stageChanged', {
      stage: this.stage,
      timer: this.timer,
      isPaused: this.isPaused,
      turn: this.turn,
    })
    this.broadcastVotes()
  }

  private alive(): Player[] {
    return this.players.filter((p) => p.isAlive)
  }

  vote(voterId: string, targetId: string): void {
    if (!this.isVoting()) return
    const voter = this.players.find((p) => p.id === voterId)
    const target = this.players.find((p) => p.id === targetId)
    if (!voter?.isAlive || !target?.isAlive) return
    if (voterId === targetId) return
    if (this.voteCandidates && !this.voteCandidates.includes(targetId)) return

    this.votes.set(voterId, targetId)
    this.broadcastVotes()
  }

  private tally(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const targetId of this.votes.values()) {
      result[targetId] = (result[targetId] || 0) + 1
    }
    return result
  }

  private broadcastVotes(): void {
    this.io.to(this.code).emit('votesUpdated', {
      tally: this.tally(),
      voted: [...this.votes.keys()],
    })
  }

  /** Хост завершает голосование: подсчёт, выбывание или второй тур при ничьей. */
  resolveVote(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    if (!this.isVoting()) return

    const tally = this.tally()
    const entries = Object.entries(tally)

    if (entries.length === 0) {
      // Никто не голосовал — никто не выбывает, начинаем следующий раунд.
      this.io.to(this.code).emit('voteResult', {
        eliminatedId: null,
        tie: false,
        tiedIds: [],
        tally,
      })
      this.beginRevealRound(this.turn.round + 1)
      return
    }

    const max = Math.max(...entries.map(([, count]) => count))
    const leaders = entries.filter(([, count]) => count === max).map(([id]) => id)

    // Ничья в первом туре — назначаем переголосование среди лидеров.
    if (leaders.length > 1 && this.stage === 'vote1') {
      this.io.to(this.code).emit('voteResult', {
        eliminatedId: null,
        tie: true,
        tiedIds: leaders,
        tally,
      })
      this.stage = 'vote2'
      this.votes.clear()
      this.voteCandidates = leaders
      this.startTimer(this.settings.voteSeconds, null)
      this.io.to(this.code).emit('stageChanged', {
        stage: 'vote2',
        timer: this.timer,
        isPaused: this.isPaused,
        turn: this.turn,
      })
      this.broadcastVotes()
      return
    }

    // Иначе выбывает лидер (при ничьей во втором туре — случайный из равных).
    const eliminatedId = leaders[Math.floor(Math.random() * leaders.length)]
    const eliminated = this.players.find((p) => p.id === eliminatedId)
    if (eliminated) eliminated.isAlive = false

    this.votes.clear()
    this.voteCandidates = null
    this.io.to(this.code).emit('voteResult', {
      eliminatedId,
      tie: false,
      tiedIds: [],
      tally,
    })
    this.broadcastPlayers()
    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })

    // Проверяем победу; если игра продолжается — новый раунд вскрытия.
    if (this.checkWinCondition()) return
    this.beginRevealRound(this.turn.round + 1)
  }

  // ─── Условие победы ────────────────────────────────────────────────────

  /** Возвращает true, если игра завершилась. */
  private checkWinCondition(): boolean {
    if (this.stage === 'end') return true
    const aliveCount = this.alive().length
    const target = this.survivorsTarget(this.startCount)
    if (aliveCount <= target) {
      this.endGame()
      return true
    }
    return false
  }

  private endGame(): void {
    this.stopTimer()
    this.stage = 'end'
    this.turn = { ...this.turn, currentPlayerId: null }
    const survivorIds = this.alive().map((p) => p.id)
    this.io.to(this.code).emit('gameEnded', {
      survivorIds,
      players: this.publicPlayers(),
    })
    this.io.to(this.code).emit('stageChanged', {
      stage: 'end',
      timer: 0,
      isPaused: false,
      turn: this.turn,
    })
  }

  // ─── Таймер (авторитетный, серверный) ────────────────────────────────────

  private onTimerExpire: (() => void) | null = null

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

  /** Хост сбрасывает таймер текущей фазы (ход/голосование) на исходное значение. */
  resetTimer(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    if (this.stage === 'reveal') {
      this.startTimer(this.settings.turnSeconds, () => this.advanceTurn())
    } else if (this.isVoting()) {
      this.startTimer(this.settings.voteSeconds, null)
    } else {
      return
    }
    this.io.to(this.code).emit('timerResumed', { timer: this.timer, isPaused: false })
  }

  // ─── Публичное представление ────────────────────────────────────────────

  /** Данные игроков для всех: только вскрытые характеристики. */
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

  /** Полный снапшот для (ре)подключившегося клиента. */
  snapshotFor(playerId: string): void {
    const sid = this.sockets.get(playerId)
    if (!sid) return
    this.io.to(sid).emit('welcome', {
      playerId,
      isHost: this.isHost(playerId),
      settings: this.settings,
    })
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
    })
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

  /** Останавливает таймеры перед удалением лобби. */
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

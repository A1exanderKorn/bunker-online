import type { Server } from 'socket.io'
import type {
  ClientToServerEvents,
  GameStage,
  Player,
  PublicPlayer,
  ServerToClientEvents,
} from '../shared/types'
import { BIOLOGY_CATEGORY } from '../shared/types'
import { DEFAULT_TIMER, MAX_PLAYERS, MAX_TIMER, MIN_PLAYERS } from './config'
import { dealCharacteristics } from './characteristics'

type IO = Server<ClientToServerEvents, ServerToClientEvents>

/** Порядок стадий для ручного перехода хостом. */
const STAGE_FLOW: GameStage[] = ['review', 'reveal', 'vote1', 'vote2', 'end']

/**
 * Одна игровая комната: инкапсулирует состояние, серверный таймер,
 * вскрытие характеристик и голосование.
 */
export class Lobby {
  readonly code: string
  private io: IO
  players: Player[] = []
  stage: GameStage = 'lobby'
  started = false

  private timer = DEFAULT_TIMER
  private isPaused = false
  private interval: ReturnType<typeof setInterval> | null = null

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

  isHost(socketId: string): boolean {
    return this.host?.id === socketId
  }

  isEmpty(): boolean {
    return this.players.length === 0
  }

  addPlayer(id: string, name: string): boolean {
    if (this.started || this.players.length >= MAX_PLAYERS) return false
    if (this.players.some((p) => p.id === id)) return false
    this.players.push({ id, name, characteristics: [], biology: null, isAlive: true })
    this.broadcastPlayers()
    return true
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id)
    this.votes.delete(id)
    if (!this.isEmpty()) {
      this.broadcastPlayers()
      if (this.stage === 'vote1' || this.stage === 'vote2') this.broadcastVotes()
    }
  }

  private broadcastPlayers(): void {
    this.io.to(this.code).emit(
      'updatePlayers',
      this.players.map((p) => ({ id: p.id, name: p.name, isAlive: p.isAlive })),
    )
  }

  // ─── Старт игры ────────────────────────────────────────────────────────

  start(requesterId: string): void {
    if (!this.isHost(requesterId)) return
    if (this.started) return
    if (this.players.length < MIN_PLAYERS) {
      this.io.to(requesterId).emit('errorMessage', {
        message: `Нужно минимум ${MIN_PLAYERS} игрока для старта`,
      })
      return
    }

    // Порядок игроков не перемешиваем: хостом остаётся создатель (players[0]),
    // что совпадает с определением хоста на клиенте. Случайный порядок ходов,
    // если понадобится, будет храниться отдельно.
    dealCharacteristics(this.players)
    this.started = true
    this.stage = 'review'

    // Каждому — его собственные характеристики (приватно).
    for (const player of this.players) {
      if (!player.biology) continue
      this.io.to(player.id).emit('yourCharacteristics', {
        characteristics: player.characteristics,
        biology: player.biology,
      })
    }

    this.io.to(this.code).emit('gameStarted', {
      players: this.publicPlayers(),
      stage: this.stage,
    })
    this.startTimer(DEFAULT_TIMER)
  }

  // ─── Вскрытие характеристик ──────────────────────────────────────────────

  /** Игрок вскрывает СВОЮ характеристику (сервер не даёт вскрыть чужую). */
  reveal(requesterId: string, type: string): void {
    const player = this.players.find((p) => p.id === requesterId)
    if (!player) return

    if (type === BIOLOGY_CATEGORY) {
      if (!player.biology) return
      player.biology.isVisible = true
    } else {
      const char = player.characteristics.find((c) => c.type === type)
      if (!char) return
      char.isVisible = true
    }

    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })
  }

  // ─── Таймер (авторитетный, серверный) ────────────────────────────────────

  private startTimer(seconds: number): void {
    this.stopTimer()
    this.timer = seconds
    this.isPaused = false
    this.interval = setInterval(() => {
      if (this.isPaused) return
      this.timer -= 1
      this.io.to(this.code).emit('timerTick', { timer: this.timer, isPaused: false })
      if (this.timer <= 0) this.stopTimer()
    }, 1000)
  }

  private stopTimer(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
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

  resetTimer(requesterId: string, timerValue?: number): void {
    if (!this.isHost(requesterId)) return
    this.startTimer(this.clampTimer(timerValue))
  }

  private clampTimer(value?: number): number {
    if (!value || value <= 0) return DEFAULT_TIMER
    return Math.min(value, MAX_TIMER)
  }

  // ─── Стадии ──────────────────────────────────────────────────────────────

  nextStage(requesterId: string, timerValue?: number): void {
    if (!this.isHost(requesterId)) return
    const idx = STAGE_FLOW.indexOf(this.stage)
    const next = idx >= 0 && idx < STAGE_FLOW.length - 1 ? STAGE_FLOW[idx + 1] : this.stage
    this.setStage(next, timerValue)
  }

  private setStage(stage: GameStage, timerValue?: number): void {
    this.stage = stage
    this.resetVotes()
    const seconds = this.clampTimer(timerValue)
    this.startTimer(seconds)
    this.io.to(this.code).emit('stageChanged', { stage, timer: seconds, isPaused: false })
    if (stage === 'vote1' || stage === 'vote2') this.broadcastVotes()
  }

  // ─── Голосование ──────────────────────────────────────────────────────────

  private resetVotes(): void {
    this.votes.clear()
    this.voteCandidates = null
  }

  private alive(): Player[] {
    return this.players.filter((p) => p.isAlive)
  }

  vote(voterId: string, targetId: string): void {
    if (this.stage !== 'vote1' && this.stage !== 'vote2') return
    const voter = this.players.find((p) => p.id === voterId)
    const target = this.players.find((p) => p.id === targetId)
    if (!voter?.isAlive || !target?.isAlive) return
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
    if (this.stage !== 'vote1' && this.stage !== 'vote2') return

    const tally = this.tally()
    const entries = Object.entries(tally)

    if (entries.length === 0) {
      this.io.to(this.code).emit('voteResult', {
        eliminatedId: null,
        tie: false,
        tiedIds: [],
        tally,
      })
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
      this.startTimer(DEFAULT_TIMER)
      this.io.to(this.code).emit('stageChanged', {
        stage: 'vote2',
        timer: DEFAULT_TIMER,
        isPaused: false,
      })
      this.broadcastVotes()
      return
    }

    // Иначе выбывает лидер (при ничьей во втором туре — случайный из равных).
    const eliminatedId = leaders[Math.floor(Math.random() * leaders.length)]
    const eliminated = this.players.find((p) => p.id === eliminatedId)
    if (eliminated) eliminated.isAlive = false

    this.resetVotes()
    this.io.to(this.code).emit('voteResult', {
      eliminatedId,
      tie: false,
      tiedIds: [],
      tally,
    })
    this.broadcastPlayers()
    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })
  }

  // ─── Публичное представление ────────────────────────────────────────────

  /** Данные игроков для всех: только вскрытые характеристики. */
  private publicPlayers(): PublicPlayer[] {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      isAlive: p.isAlive,
      characteristics: p.characteristics.filter((c) => c.isVisible),
      biology: p.biology?.isVisible ? p.biology : null,
    }))
  }

  /** Останавливает таймеры перед удалением лобби. */
  dispose(): void {
    this.stopTimer()
  }
}

/** Реестр всех активных лобби. */
export class LobbyManager {
  private lobbies = new Map<string, Lobby>()

  constructor(private io: IO) {}

  getOrCreate(code: string): Lobby {
    let lobby = this.lobbies.get(code)
    if (!lobby) {
      lobby = new Lobby(this.io, code)
      this.lobbies.set(code, lobby)
    }
    return lobby
  }

  get(code: string): Lobby | undefined {
    return this.lobbies.get(code)
  }

  remove(code: string): void {
    this.lobbies.get(code)?.dispose()
    this.lobbies.delete(code)
  }
}

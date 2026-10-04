import type { Server } from 'socket.io'
import type {
  ActionCard,
  Biology,
  CardHistoryCharChange,
  CardHistoryChangeKind,
  CardHistoryEntry,
  CardTargets,
  CharSlot,
  ClientToServerEvents,
  GameStage,
  GameMode,
  LobbySettings,
  Player,
  PublicPlayer,
  RoundStep,
  ServerToClientEvents,
  SurvivalReport,
  TurnState,
  VoteResultPayload,
} from '../shared/types'
import {
  BIOLOGY_CATEGORY,
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  defaultRoundSteps,
  formatBiology,
  formatCharacteristicValue,
} from '../shared/types'
import {
  LOBBY_RECONNECT_GRACE_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RECONNECT_GRACE_MS,
  TURN_GRACE_SECONDS,
} from './config'
import {
  dealCharacteristics,
  buildCharLayout,
  drawUniqueCharacteristics,
  findChar,
  shuffleArray,
  generateBiology,
  generateOrdinaryBiology,
} from './characteristics'
import { generateRareBiology, biologyCoefficient } from './biology'
import { expandForDeal, rowsByCategory } from './data'
import {
  pickCatastrophe,
  pickUnusedCondition,
  threatQueue,
  challengeTitle,
  toPublicBunker,
  loadBunkerData,
  type StoredBunkerCondition,
  type StoredBunkerState,
} from './bunker'
import { dealActionCards, makeCardByCatalogId, loadCards } from './cards'
import { biologyTags, improvedOrWorseBiology, improvedOrWorseCharacteristic } from './cardEffects'
import { calculateSurvival } from './survival'
import { filterCardHistory } from './cardHistory'
import { MatchRecorder, enqueueMatch } from './matchHistory'
import type { Profile } from '../shared/profile'

type IO = Server<ClientToServerEvents, ServerToClientEvents>

interface LastPlayedEffect {
  card: ActionCard
  targets: CardTargets
  byPlayerId: string
}

interface VoteInterrupt {
  rewoundVoterId: string
  resumeVoterId: string
  resumeIndex: number
}

function cloneCardTargets(targets: CardTargets): CardTargets {
  return JSON.parse(JSON.stringify(targets)) as CardTargets
}

const EMPTY_TURN: TurnState = {
  currentPlayerId: null,
  stepIndex: 0,
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
  private matchRecorder: MatchRecorder | null = null
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
  /** Стартовые места матча, отдельно от списка лобби и прав хоста. */
  private matchOrder: string[] = []

  // ── Состояние ходов ──
  private turn: TurnState = { ...EMPTY_TURN }
  private randomRevealStep = -1
  private randomRevealRolled = new Set<string>()
  private forcedReveal: { category: string; occ: number } | null = null
  private turnOrder: string[] = []
  private turnIndex = 0
  private turnGraceGiven = false

  // ── Голосование ──
  private votes = new Map<string, string>()
  private voteCandidates: string[] | null = null
  private lastVoteResult: VoteResultPayload | null = null

  // ── Бункер ──
  private bunker: StoredBunkerState = { catastrophe: '', years: 0, threats: [], conditions: [] }
  private pendingThreats: string[] = []
  private charLayout: CharSlot[] = []
  private survivalReport: SurvivalReport | null = null

  // ── Карты действия ──
  /** playerId -> карты игрока. */
  private cards = new Map<string, ActionCard[]>()
  /** Последний реально применённый эффект (карта replayLast сюда не записывается). */
  private lastPlayedEffect: LastPlayedEffect | null = null
  private cardInstanceCounter = 1000
  private cardHistory: CardHistoryEntry[] = []
  /** playerId -> последняя вскрытая характеристика. */
  private lastRevealed = new Map<string, { category: string; occ: number }>()
  /** Переголосование: предыдущие голоса (нельзя выбрать ту же цель). */
  private revoteFrom = new Map<string, string>()
  // Модификаторы голосования (сбрасываются по раундам).
  /** playerId, чьи голоса аннулированы в следующем голосовании. */
  private cancelledVoters = new Set<string>()
  /** playerId -> вес голоса (по умолчанию 1). */
  private voteWeight = new Map<string, number>()
  /** targetId, которого нельзя выбирать в следующем голосовании (защита). */
  private protectedFromVote = new Set<string>()
  /** Постоянная защита: voterId -> не может голосовать против protectedId. */
  private voteBans: { voterId: string; protectedId: string }[] = []
  /** Стек возврата к прерванным голосующим после карт doubleVote. */
  private voteInterrupts: VoteInterrupt[] = []

  constructor(io: IO, code: string, private readonly onEmpty: () => void = () => {}) {
    this.io = io
    this.code = code
  }

  private gameMode(): GameMode {
    return this.settings.gameMode === 'new' ? 'new' : 'classic'
  }

  private rollBiology(existing: Biology[]): Biology {
    if (this.gameMode() !== 'new') return generateBiology(existing)
    return generateRareBiology(existing) ?? generateOrdinaryBiology()
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

  /** Есть ли игрок этого браузера, включая ещё не успевший отключиться старый сокет. */
  hasClient(clientId: string): boolean {
    return this.players.some((p) => p.clientId === clientId)
  }

  /**
   * Добавляет нового игрока или переподключает существующего.
   * Игрок идентифицируется по стабильному clientId (а не по имени или socket.id),
   * поэтому разные вкладки/устройства — разные игроки, а чужого нельзя перехватить по имени.
   * Результат: { playerId, error? }. При ошибке playerId = null и есть внятный error.
   */
  addOrReconnect(
    socketId: string,
    clientId: string,
    name: string,
    profile?: Profile,
  ): { playerId: string | null; error?: string } {
    // Реконнект: игрок с таким clientId уже есть. Ловим оба случая:
    // 1) старый сокет уже отвалился (connected=false) — обычный реконнект;
    // 2) событие disconnect ещё не пришло (мобильное замерзание вкладки) —
    //    новое соединение заменяет зависший сокет того же клиента.
    const existing = this.players.find((p) => p.clientId === clientId)
    if (existing) {
      // Проверяем новое имя до любых изменений сокетов.
      if (!this.started && name && existing.name !== name) {
        if (this.players.some((p) => p.id !== existing.id && p.name === name)) {
          return { playerId: null, error: 'Имя уже занято — выберите другое' }
        }
        existing.name = name
      }
      const pending = this.removalTimers.get(existing.id)
      if (pending) {
        clearTimeout(pending)
        this.removalTimers.delete(existing.id)
      }
      // Сначала назначаем новый сокет: синхронный disconnect старого увидит,
      // что он уже не текущий, и не удалит игрока из лобби.
      const oldSocketId = this.sockets.get(existing.id)
      this.sockets.set(existing.id, socketId)
      // Если был старый живой сокет этого же клиента — разрываем (дубль вкладки).
      if (oldSocketId && oldSocketId !== socketId) {
        const oldSock = this.io.sockets.sockets.get(oldSocketId)
        if (oldSock) {
          oldSock.data.playerId = undefined
          oldSock.disconnect()
        }
      }
      existing.connected = true
      existing.avatarUrl = profile?.avatarUrl
      this.broadcastPlayers()
      return { playerId: existing.id }
    }

    // Новый игрок (clientId ещё не видели).
    if (this.started) return { playerId: null, error: 'Игра уже началась, вход закрыт' }
    if (this.players.length >= MAX_PLAYERS) return { playerId: null, error: 'Лобби заполнено' }
    // Имя — только для отображения; запрещаем дубли имён, чтобы игроков не путали.
    if (this.players.some((p) => p.name === name)) {
      return { playerId: null, error: 'Имя уже занято — выберите другое' }
    }

    const playerId = `p_${Math.random().toString(36).slice(2, 10)}`
    this.players.push({
      id: playerId,
      clientId,
      name,
      profileId: profile?.id,
      avatarUrl: profile?.avatarUrl,
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
    return { playerId }
  }

  handleDisconnect(playerId: string, socketId?: string): void {
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return
    // Защита от гонки: если игрок уже переподключился новым сокетом,
    // а это событие пришло от старого (заменённого) — игнорируем его.
    if (socketId && this.sockets.get(playerId) !== socketId) return
    this.sockets.delete(playerId)

    player.connected = false
    this.broadcastPlayers()
    // До старта держим место недолго: этого хватает для F5, но закрытая
    // вкладка не оставит остальных ждать офлайн-хоста несколько минут.
    const graceMs = this.started ? RECONNECT_GRACE_MS : LOBBY_RECONNECT_GRACE_MS
    const t = setTimeout(() => this.removePlayerNow(playerId), graceMs)
    this.removalTimers.set(playerId, t)
  }

  kickPlayer(requesterId: string, targetId: string): void {
    if (!this.isHost(requesterId) || this.started || targetId === requesterId) return
    if (!this.players.some(p => p.id === targetId)) return
    const sid = this.socketOf(targetId)
    const socket = sid ? this.io.sockets.sockets.get(sid) : undefined
    this.removePlayerNow(targetId)
    if (socket) {
      socket.emit('kicked', { message: 'Хост удалил вас из лобби. Вы можете войти снова.' })
      socket.leave(this.code)
      socket.disconnect(true)
    }
  }

  private removePlayerNow(playerId: string): void {
    if (this.started && this.stage !== 'end') this.matchRecorder?.eliminate(playerId)
    const wasCurrent = this.turn.currentPlayerId === playerId
    const wasVoter = this.turn.currentVoterId === playerId
    this.players = this.players.filter((p) => p.id !== playerId)
    this.sockets.delete(playerId)
    this.votes.delete(playerId)
    for (const [voter, target] of this.votes) if (target === playerId) this.votes.delete(voter)
    this.turnOrder = this.turnOrder.filter((id) => id !== playerId)
    const rt = this.removalTimers.get(playerId)
    if (rt) {
      clearTimeout(rt)
      this.removalTimers.delete(playerId)
    }
    if (this.isEmpty()) {
      this.onEmpty()
      return
    }

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
        else { this.broadcastVotes(); this.finishIfEveryoneVoted() }
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
        avatarUrl: p.avatarUrl,
        isAlive: p.isAlive,
        connected: p.connected,
      })),
    )
  }

  // ─── Настройки ─────────────────────────────────────────────────────────

  updateSettings(playerId: string, incoming: Partial<LobbySettings>): void {
    if (!this.isHost(playerId)) return
    if (this.started) {
      if (typeof incoming.revealPreviousCharacteristics !== 'boolean') return
      const next = !!incoming.revealPreviousCharacteristics
      if (next === this.settings.revealPreviousCharacteristics) return
      this.settings = { ...this.settings, revealPreviousCharacteristics: next }
      this.io.to(this.code).emit('settingsUpdated', { settings: this.settings })
      this.broadcastCardHistory()
      return
    }
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
      randomTargetCoef: !!s.randomTargetCoef,
      survivorsCount: Math.round(
        clampNum(s.survivorsCount, L.survivorsCount.min, L.survivorsCount.max, DEFAULT_SETTINGS.survivorsCount),
      ),
      voteMode: s.voteMode === 'sequential' ? 'sequential' : 'simultaneous',
      extraBaggage: !!s.extraBaggage,
      noPhobias: !!s.noPhobias,
      threatsEnabled: !!s.threatsEnabled,
      actionCardsEnabled: !!s.actionCardsEnabled,
      revealPreviousCharacteristics: !!s.revealPreviousCharacteristics,
      cardsPower: s.cardsPower === 'weak' || s.cardsPower === 'strong' ? s.cardsPower : 'balanced',
      gameMode: s.gameMode === 'new' ? 'new' : 'classic',
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

    this.matchOrder = shuffleArray(this.players.map(p => p.id))
    dealCharacteristics(this.playersInMatchOrder(), {
      targetCoef: this.settings.randomTargetCoef ? null : this.settings.targetCoef,
      extraBaggage: this.settings.extraBaggage,
      noPhobias: this.settings.noPhobias,
      gameMode: this.gameMode(),
    })
    this.started = true
    this.lastVoteResult = null
    this.matchRecorder = new MatchRecorder(this.players, this.gameMode(), this.settings.targetCoef, this.settings.randomTargetCoef)
    this.startCount = this.players.length
    this.stepIndex = 0

    // Бункер: катастрофа + случайные годы (1–15) + очередь угроз под помеченные шаги.
    const threatSteps = this.settings.threatsEnabled
      ? this.settings.roundSteps.filter((s) => s.kind === 'reveal' && s.revealThreat).length
      : 0
    this.pendingThreats = threatQueue(threatSteps, this.gameMode())
    this.bunker = {
      catastrophe: pickCatastrophe(this.gameMode()),
      years: 1 + Math.floor(Math.random() * 15),
      threats: [],
      conditions: [],
    }
    this.survivalReport = null
    this.charLayout = buildCharLayout(this.settings)
    this.lastRevealed.clear()
    this.revoteFrom.clear()

    // Раздаём карты действия, если включены.
    this.cards.clear()
    this.lastPlayedEffect = null
    this.cardHistory = []
    this.cancelledVoters.clear()
    this.voteWeight.clear()
    this.protectedFromVote.clear()
    this.voteBans = []
    this.voteInterrupts = []
    if (this.settings.actionCardsEnabled) {
      const dealt = dealActionCards(this.players, this.settings.cardsPower, this.gameMode())
      for (const [pid, card] of dealt.entries()) this.cards.set(pid, [card])
    }

    for (const player of this.players) {
      if (!player.biology) continue
      const sid = this.sockets.get(player.id)
      if (sid) {
        this.io.to(sid).emit('yourCharacteristics', {
          characteristics: player.characteristics,
          biology: player.biology,
        })
        this.io.to(sid).emit('yourCards', { cards: this.cards.get(player.id) ?? [] })
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
      bunker: toPublicBunker(this.bunker, this.gameMode()),
      actionCards: [],
      charLayout: this.charLayout,
      cardHistory: [],
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
    this.matchRecorder = null
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
    this.lastVoteResult = null
    this.matchOrder = []
    this.stage = 'lobby'
    this.turn = { ...EMPTY_TURN }
    this.votes.clear()
    this.voteCandidates = null
    this.bunker = { catastrophe: '', years: 0, threats: [], conditions: [] }
    this.survivalReport = null
    this.pendingThreats = []
    this.cards.clear()
    this.lastPlayedEffect = null
    this.cardHistory = []
    this.lastRevealed.clear()
    this.revoteFrom.clear()
    this.charLayout = []
    this.cancelledVoters.clear()
    this.voteWeight.clear()
    this.protectedFromVote.clear()
    this.voteBans = []
    this.voteInterrupts = []
    this.stepIndex = 0
    this.regenerateDefaultSteps()
    this.broadcastPlayers()
    this.io.to(this.code).emit('settingsUpdated', { settings: this.settings })
    this.io.to(this.code).emit('newGameStarted', {})
  }

  // ─── Карты действия ──────────────────────────────

  private cardStageOk(stage: string): boolean {
    if (stage === 'any') return true
    if (stage === 'reveal') return this.stage === 'reveal'
    if (stage === 'vote') return this.isVoting()
    return false
  }

  private randomCharValue(category: string): {
    value: string
    coef: number
    hint: string
    tags: string[]
    stageLabel?: string
    stageIndex?: number
    incurable?: boolean
  } | null {
    const pool = rowsByCategory(category, this.gameMode()).flatMap(expandForDeal)
    if (pool.length === 0) return null
    const r = pool[Math.floor(Math.random() * pool.length)]
    return {
      value: r.row.name,
      coef: r.coef,
      hint: r.hint,
      tags: [...r.row.tags],
      stageLabel: r.stageLabel,
      stageIndex: r.stageIndex,
      incurable: r.incurable,
    }
  }

  private replaceChar(pl: Player, category: string, occ = 0): boolean {
    if (category === BIOLOGY_CATEGORY) return this.rerollBiology(pl)
    const ch = findChar(pl.characteristics, category, occ)
    if (!ch) return false
    const rc = this.randomCharValue(category)
    if (!rc) return false
    ch.value = rc.value
    ch.coef = rc.coef
    ch.hint = rc.hint
    ch.tags = rc.tags
    ch.stageLabel = rc.stageLabel
    ch.stageIndex = rc.stageIndex
    ch.incurable = rc.incurable
    return true
  }

  /** Массовая перераздача без повторов между получателями. */
  private replaceCategoryAll(category: string, occ = 0): boolean {
    const recipients = this.alive()
      .map((player) => ({ player, characteristic: findChar(player.characteristics, category, occ) }))
      .filter((entry) => entry.characteristic != null)
    if (recipients.length === 0) return false

    const excluded = this.alive().flatMap((player) =>
      player.characteristics
        .filter((characteristic) => characteristic.type === category && (characteristic.occ ?? 0) !== occ)
        .map((characteristic) => characteristic.value),
    )
    const replacements = drawUniqueCharacteristics(category, recipients.length, excluded, this.gameMode())
    if (replacements.length < recipients.length) return false

    recipients.forEach(({ characteristic }, index) => {
      const replacement = replacements[index]
      characteristic!.value = replacement.value
      characteristic!.coef = replacement.coef
      characteristic!.hint = replacement.hint
      characteristic!.tags = replacement.tags
      characteristic!.stageLabel = replacement.stageLabel
      characteristic!.stageIndex = replacement.stageIndex
      characteristic!.incurable = replacement.incurable
    })
    return true
  }

  private rerollBiology(pl: Player): boolean {
    const others = this.players.filter((p) => p.id !== pl.id && p.biology).map((p) => p.biology!)
    const visible = pl.biology?.isVisible ?? false
    const bio = this.rollBiology(others)
    bio.isVisible = visible
    pl.biology = bio
    return true
  }

  private rerollBiologyAll(): void {
    const newBios: Biology[] = []
    for (const pl of this.alive()) {
      const visible = pl.biology?.isVisible ?? false
      const bio = this.rollBiology(newBios)
      bio.isVisible = visible
      pl.biology = bio
      newBios.push(bio)
    }
  }

  private slotLabel(category: string, occ: number, pl?: Player): string {
    if (category === BIOLOGY_CATEGORY) return BIOLOGY_CATEGORY
    const total = pl ? pl.characteristics.filter((c) => c.type === category).length : 1
    if (total <= 1) return category
    return `${category} #${occ + 1}`
  }

  private normalizeSlotType(category: string): string {
    if (category === 'biology' || category === BIOLOGY_CATEGORY) return BIOLOGY_CATEGORY
    return category
  }

  private slotVisible(pl: Player, category: string, occ: number): boolean {
    const type = this.normalizeSlotType(category)
    if (type === BIOLOGY_CATEGORY) return pl.biology?.isVisible ?? false
    return findChar(pl.characteristics, type, occ)?.isVisible ?? false
  }

  private slotDisplay(pl: Player, category: string, occ: number): string {
    const type = this.normalizeSlotType(category)
    if (type === BIOLOGY_CATEGORY) return formatBiology(pl.biology) ?? ''
    return formatCharacteristicValue(findChar(pl.characteristics, type, occ)) ?? ''
  }

  private pushChange(
    changes: CardHistoryCharChange[],
    pl: Player,
    category: string,
    occ: number,
    kind: CardHistoryChangeKind,
    oldValue: string,
    newValue: string,
    wasVisible: boolean,
  ): void {
    const slotType = this.normalizeSlotType(category)
    changes.push({
      playerId: pl.id,
      playerName: pl.name,
      slotType,
      slotOcc: occ,
      slotLabel: this.slotLabel(slotType, occ, pl),
      wasVisible,
      changeKind: kind,
      oldValue,
      newValue,
    })
  }

  private pushPublicChange(
    changes: CardHistoryCharChange[],
    slotLabel: string,
    oldValue: string,
    newValue: string,
    pl?: Player,
  ): void {
    changes.push({
      playerId: pl?.id ?? '',
      playerName: pl?.name ?? '',
      slotType: slotLabel,
      slotOcc: 0,
      slotLabel,
      wasVisible: true,
      changeKind: 'replace',
      oldValue,
      newValue,
    })
  }

  private applyTracked(
    changes: CardHistoryCharChange[],
    pl: Player,
    category: string,
    occ: number,
  ): boolean {
    const type = this.normalizeSlotType(category)
    const oldValue = this.slotDisplay(pl, type, occ)
    const wasVisible = this.slotVisible(pl, type, occ)
    if (!this.applySlot(pl, type, occ)) return false
    this.pushChange(changes, pl, type, occ, 'replace', oldValue, this.slotDisplay(pl, type, occ), wasVisible)
    return true
  }

  private replaceCategoryAllTracked(changes: CardHistoryCharChange[], category: string, occ = 0): boolean {
    const recipients = this.alive()
      .map((player) => ({
        player,
        oldValue: this.slotDisplay(player, category, occ),
        wasVisible: this.slotVisible(player, category, occ),
      }))
      .filter((entry) => findChar(entry.player.characteristics, category, occ) != null)
    if (!this.replaceCategoryAll(category, occ)) return false
    for (const entry of recipients) {
      this.pushChange(
        changes,
        entry.player,
        category,
        occ,
        'replace',
        entry.oldValue,
        this.slotDisplay(entry.player, category, occ),
        entry.wasVisible,
      )
    }
    return true
  }

  private rerollBiologyAllTracked(changes: CardHistoryCharChange[]): void {
    const snaps = this.alive().map((player) => ({
      player,
      oldValue: this.slotDisplay(player, BIOLOGY_CATEGORY, 0),
      wasVisible: this.slotVisible(player, BIOLOGY_CATEGORY, 0),
    }))
    this.rerollBiologyAll()
    for (const snap of snaps) {
      this.pushChange(
        changes,
        snap.player,
        BIOLOGY_CATEGORY,
        0,
        'replace',
        snap.oldValue,
        this.slotDisplay(snap.player, BIOLOGY_CATEGORY, 0),
        snap.wasVisible,
      )
    }
  }

  cardHistoryFor(viewerId?: string): CardHistoryEntry[] {
    const viewer = viewerId ? this.players.find((player) => player.id === viewerId) : undefined
    return filterCardHistory(
      this.cardHistory,
      viewer,
      this.players,
      this.stage,
      this.settings.revealPreviousCharacteristics,
    )
  }

  private broadcastCardHistory(): void {
    for (const player of this.players) {
      const sid = this.sockets.get(player.id)
      if (sid) {
        this.io.to(sid).emit('cardHistoryUpdated', { cardHistory: this.cardHistoryFor(player.id) })
      }
    }
  }

  private sendCardsTo(playerId: string): void {
    const sid = this.sockets.get(playerId)
    if (sid) this.io.to(sid).emit('yourCards', { cards: this.cards.get(playerId) ?? [] })
  }

  /** Админ-тест: отправляет каталог карт запросившему. */
  sendCatalog(playerId: string): void {
    const sid = this.sockets.get(playerId)
    if (!sid) return
    const cards = loadCards().map((d) => ({
      cardId: d.cardId,
      category: d.category,
      title: d.title,
      code: d.code,
      stage: d.stage,
      picks: d.picks,
    }))
    this.io.to(sid).emit('cardCatalog', { cards })
  }

  /** Админ-тест: выдаёт игроку конкретную карту по cardId. */
  adminGiveCard(playerId: string, cardId: string): void {
    if (!this.started || !this.isHost(playerId)) return
    const card = makeCardByCatalogId(cardId, `ci_${this.cardInstanceCounter++}`)
    if (!card) return
    const arr = this.cards.get(playerId) ?? []
    arr.push(card)
    this.cards.set(playerId, arr)
    this.sendCardsTo(playerId)
  }

  /** Игрок активирует карту с выбранными целями. */
  playCard(playerId: string, instanceId: string, targets: CardTargets): void {
    if (!this.started || this.stage === 'end') return
    const arr = this.cards.get(playerId)
    const card = arr?.find((c) => c.instanceId === instanceId)
    if (!card || card.used) return
    if (!this.cardStageOk(card.stage)) {
      this.emitError(playerId, 'Эту карту нельзя сыграть сейчас')
      return
    }

    const targetError = this.validateCardTargets(playerId, card, targets)
    if (targetError) { this.emitError(playerId, targetError); return }

    const effect = this.applyCardEffect(playerId, card, targets)
    if (!effect.ok) {
      this.emitError(playerId, effect.error ?? 'Неверные цели карты')
      return
    }

    if (card.action === 'replayLast') {
      const index = arr?.findIndex((candidate) => candidate.instanceId === instanceId) ?? -1
      if (index >= 0) arr!.splice(index, 1)
    } else {
      card.used = true
      this.lastPlayedEffect = {
        card: { ...card },
        targets: cloneCardTargets(targets),
        byPlayerId: playerId,
      }
    }
    this.sendCardsTo(playerId)

    const byName = this.players.find((p) => p.id === playerId)?.name ?? '?'
    const summary = effect.text ?? card.title
    this.cardHistory.unshift({
      seq: this.cardHistory.length + 1,
      round: this.turn.round,
      stage: this.stage,
      byPlayerId: playerId,
      byName,
      cardTitle: card.title,
      summary,
      charChanges: effect.charChanges,
    })
    this.io.to(this.code).emit('cardPlayed', {
      byPlayerId: playerId,
      byName,
      title: card.title,
      effectText: summary,
    })
    this.broadcastCardHistory()
    // Обновляем публичное состояние и бункер.
    this.broadcastCharacters()
    this.io.to(this.code).emit('bunkerUpdated', { bunker: toPublicBunker(this.bunker, this.gameMode()) })
    // Приватно обновляем характеристики затронутых игроков.
    for (const p of this.players) {
      const sid = this.sockets.get(p.id)
      if (sid && p.biology) {
        this.io.to(sid).emit('yourCharacteristics', {
          characteristics: p.characteristics,
          biology: p.biology,
        })
      }
    }
    if (this.isVoting()) this.broadcastVotes()
  }

  /** Проверяем весь выбор до применения эффекта, чтобы ошибка не меняла состояние. */
  private validateCardTargets(playerId: string, card: ActionCard, targets: CardTargets): string | null {
    if (!targets || typeof targets !== 'object') return 'Неверные цели карты'
    const fields = { player: 'players', characteristic: 'characteristics', catCategory: 'categories', threat: 'threats' } as const
    for (const [kind, field] of Object.entries(fields)) {
      const values = targets[field as keyof CardTargets] ?? []
      if (!Array.isArray(values) || values.length !== card.pickSpecs.filter(s => s.kind === kind).length) return 'Неверное количество целей'
    }
    const players = targets.players ?? []
    if (new Set(players).size !== players.length || players.some(id => !this.alive().some(p => p.id === id))) return 'Выберите разных невыбывших игроков'
    const playerSpecs = card.pickSpecs.filter(s => s.kind === 'player')
    if (players.some((id, i) => playerSpecs[i].excludeSelf && id === playerId)) return 'Выберите другого игрока'
    const chars = targets.characteristics ?? []
    if (new Set(chars.map(c => `${c?.playerId}/${c?.category}/${c?.occ ?? 0}`)).size !== chars.length) return 'Характеристики не должны повторяться'
    const specs = card.pickSpecs.filter(s => s.kind === 'characteristic')
    for (const [i, c] of chars.entries()) {
      if (!c) return 'Не выбрана характеристика'
      const spec = specs[i]
      const ownerId = spec.characteristicOwner === 'self' ? playerId : (players[players.length - 1] ?? playerId)
      const owner = this.players.find(p => p.id === ownerId)
      const occ = c.occ ?? 0
      if (c.playerId !== ownerId || !owner || !Number.isInteger(occ) || occ < 0) return 'Неверный владелец или слот'
      if (c.category === BIOLOGY_CATEGORY ? (!owner.biology || occ !== 0) : !findChar(owner.characteristics, c.category, occ)) return 'Характеристика отсутствует'
      if (spec.categories && !spec.categories.includes(c.category)) return 'Недопустимая категория'
      if (spec.revealedOnly && !this.slotVisible(owner, c.category, occ)) return 'Выберите открытую характеристику'
      if (spec.matchPreviousCategory && chars[i - 1]?.category !== c.category) return 'Выберите одинаковые категории'
    }
    for (const pick of targets.categories ?? []) {
      const category = typeof pick === 'string' ? pick : pick?.category
      const occ = typeof pick === 'string' ? 0 : (pick?.occ ?? 0)
      if (!category || !Number.isInteger(occ) || occ < 0 || !this.alive().some(p => category === BIOLOGY_CATEGORY ? p.biology && occ === 0 : findChar(p.characteristics, category, occ))) return 'Неверная категория или слот'
    }
    if ((targets.threats ?? []).some(i => !Number.isInteger(i) || i < 0 || i >= this.bunker.threats.length)) return 'Выберите существующую угрозу'
    return null
  }

  /** Имена игроков по id (для текста эффекта). */
  private nameOf(id: string): string {
    return this.players.find((p) => p.id === id)?.name ?? '?'
  }

  /** Удваивает голос и, если он уже был отдан, возвращает игроку право выбора. */
  private applyDoubleVote(playerId: string): { ok: boolean; text: string } {
    this.voteWeight.set(playerId, 2)
    if (!this.votes.has(playerId)) {
      return { ok: true, text: `Голос ${this.nameOf(playerId)} считается за два` }
    }

    this.votes.delete(playerId)
    if (this.isVoting()) this.broadcastVotes()

    if (this.isVoting() && this.settings.voteMode === 'sequential') {
      const rewindIndex = this.voteOrder.indexOf(playerId)
      const resumeVoterId = this.turn.currentVoterId
      if (rewindIndex >= 0 && resumeVoterId && resumeVoterId !== playerId) {
        this.voteInterrupts.push({
          rewoundVoterId: playerId,
          resumeVoterId,
          resumeIndex: this.voteOrderIndex,
        })
        this.startVoterTurn(rewindIndex)
      }
    }

    return {
      ok: true,
      text: `Голос ${this.nameOf(playerId)} считается за два — выберите заново`,
    }
  }

  private catToCategory(cat: string): string {
    const map: Record<string, string> = {
      job: 'Профессия',
      health: 'Здоровье',
      item: 'Багаж',
      fact: 'Факт',
      biology: 'Биология',
      hobby: 'Хобби',
      phobia: 'Фобия',
    }
    return map[cat] ?? cat
  }

  private applySlot(pl: Player, category: string, occ: number): boolean {
    if (category === BIOLOGY_CATEGORY || category === 'biology') return this.rerollBiology(pl)
    return this.replaceChar(pl, category, occ)
  }

  /**
   * Применяет эффект карты. Возвращает {ok, text?, error?, charChanges}.
   */
  private applyCardEffect(
    playerId: string,
    card: ActionCard,
    t: CardTargets,
  ): { ok: boolean; text?: string; error?: string; charChanges: CardHistoryCharChange[] } {
    const charChanges: CardHistoryCharChange[] = []
    const fail = (error: string) => ({ ok: false, error, charChanges: [] as CardHistoryCharChange[] })
    const ok = (text: string) => ({ ok: true, text, charChanges })
    const self = this.players.find((p) => p.id === playerId)
    if (!self) return fail('Игрок не найден')

    switch (card.action) {
      case 'randomReveal': {
        if (this.randomRevealStep === this.stepIndex) return fail('Эффект уже действует в этом раунде')
        this.randomRevealStep = this.stepIndex
        this.randomRevealRolled.clear()
        this.prepareForcedReveal()
        return ok('До конца текущего раунда в начале каждого хода — шанс 75% на обязательное случайное вскрытие вместо обычного выбора')
      }
      case 'addMatchingThreat': {
        const sources = [...self.characteristics.map(c => new Set(c.tags ?? [])), new Set(biologyTags(self.biology))]
        const choices = loadBunkerData(this.gameMode()).challenges.filter(c => c.kind === 'threat' &&
          c.requirements.length > 0 && !this.bunker.threats.includes(c.text) &&
          sources.some(tags => c.requirements.every(group => group.some(tag => tags.has(tag)))))
        if (!choices.length) return fail('Нет новой угрозы, которую полностью решает одна ваша характеристика')
        const choice = choices[Math.floor(Math.random() * choices.length)]
        this.bunker.threats.push(choice.text)
        // Если она ожидалась позже по программе, исключаем повторное появление.
        this.pendingThreats = this.pendingThreats.filter(text => text !== choice.text)
        this.pushPublicChange(charChanges, 'Угроза', 'не было', choice.title)
        return ok(`Добавлена угроза: ${choice.title}`)
      }
      case 'shuffleRevealed': {
        const pick = t.categories?.[0]
        const category = typeof pick === 'string' ? pick : pick?.category
        if (!category) return fail('Выберите категорию')
        const slots = this.alive().flatMap(player => category === BIOLOGY_CATEGORY
          ? (player.biology?.isVisible ? [{ player, occ: 0 }] : [])
          : player.characteristics.filter(c => c.type === category && c.isVisible)
            .map(c => ({ player, occ: c.occ ?? 0 })))
        if (slots.length < 2) return fail('Нужно хотя бы две открытые характеристики этой категории')
        const contents = shuffleArray(slots.map(({ player, occ }) => category === BIOLOGY_CATEGORY
          ? { ...player.biology! } : { ...findChar(player.characteristics, category, occ)! }))
        slots.forEach(({ player, occ }, i) => {
          const old = this.slotDisplay(player, category, occ)
          if (category === BIOLOGY_CATEGORY) player.biology = { ...contents[i] as Biology, isVisible: true }
          else Object.assign(findChar(player.characteristics, category, occ)!, contents[i], { type: category, occ, isVisible: true })
          this.pushChange(charChanges, player, category, occ, 'swap', old, this.slotDisplay(player, category, occ), true)
        })
        return ok(`Перемешаны открытые характеристики: ${category}`)
      }
      case 'rerollAll': {
        const planned = this.alive().map(player => ({ player, characteristics: player.characteristics.map(c => ({ ...c })), biology: player.biology }))
        const categories = new Set(planned.flatMap(p => p.characteristics.map(c => c.type)))
        for (const category of categories) {
          const slots = planned.flatMap(p => p.characteristics.filter(c => c.type === category))
          const replacements = drawUniqueCharacteristics(category, slots.length, [], this.gameMode())
          if (replacements.length !== slots.length) return fail(`Не хватает карт категории ${category}`)
          slots.forEach((slot, i) => Object.assign(slot, replacements[i], { occ: slot.occ, isVisible: slot.isVisible }))
        }
        const bios: Biology[] = []
        for (const plan of planned) {
          const bio = this.rollBiology(bios)
          bio.isVisible = plan.player.biology?.isVisible ?? false
          plan.biology = bio
          bios.push(bio)
        }
        for (const plan of planned) {
          const slots = [...plan.player.characteristics.map(c => ({ category: c.type, occ: c.occ ?? 0 })), { category: BIOLOGY_CATEGORY, occ: 0 }]
          const old = slots.map(s => ({ ...s, value: this.slotDisplay(plan.player, s.category, s.occ), visible: this.slotVisible(plan.player, s.category, s.occ) }))
          plan.player.characteristics = plan.characteristics
          plan.player.biology = plan.biology
          for (const s of old) this.pushChange(charChanges, plan.player, s.category, s.occ, 'replace', s.value, this.slotDisplay(plan.player, s.category, s.occ), s.visible)
        }
        return ok('Все характеристики и биология невыбывших игроков пересданы')
      }
      case 'biasedReroll': {
        const pick = t.categories?.[0]
        const category = typeof pick === 'string' ? pick : pick?.category
        const occ = typeof pick === 'string' ? 0 : (pick?.occ ?? 0)
        if (!category || !Number.isInteger(occ) || occ < 0) return fail('Выберите категорию и слот')
        const players = this.alive()
        // Владелец получает первый выбор; остальные — в случайном порядке.
        const ordered = [self, ...shuffleArray(players.filter(p => p.id !== self.id))].filter(p => p.isAlive)
        for (const player of ordered) {
          const old = this.slotDisplay(player, category, occ)
          const visible = this.slotVisible(player, category, occ)
          if (category === BIOLOGY_CATEGORY) {
            if (!player.biology || occ !== 0) continue
            const replacement = improvedOrWorseBiology(player.biology, player.id === self.id)
            if (!replacement) continue
            player.biology = replacement
          } else {
            const current = findChar(player.characteristics, category, occ)
            if (!current) continue
            const excluded = new Set(players.flatMap(p => p.characteristics.filter(c => c !== current && c.type === category).map(c => c.value)))
            const replacement = improvedOrWorseCharacteristic(current, player.id === self.id, excluded)
            if (!replacement) continue
            Object.assign(current, replacement)
          }
          this.pushChange(charChanges, player, category, occ, 'replace', old, this.slotDisplay(player, category, occ), visible)
        }
        if (!charChanges.length) return fail('Нет доступных улучшений или ухудшений для выбранного слота')
        return ok(`Категория ${this.slotLabel(category, occ, self)}: владельцу лучше, остальным хуже; изменено ${charChanges.length}`)
      }
      case 'rejuvenate':
      case 'makeInfertile': {
        const player = this.alive().find(p => p.id === t.players?.[0])
        if (!player?.biology) return fail('Выберите невыбывшего игрока с биологией')
        const bio = player.biology
        if (card.action === 'makeInfertile' && (bio.sex === 'Андроид' || bio.infertile)) return fail('Игрок уже бесплоден или является андроидом')
        if (card.action === 'rejuvenate' && bio.age <= 25) return fail('Игроку уже 25 лет или меньше')
        const old = this.slotDisplay(player, BIOLOGY_CATEGORY, 0)
        if (card.action === 'rejuvenate') {
          bio.age = 25
          bio.experience = Math.min(bio.experience, 9)
        } else {
          bio.infertile = true
          bio.fertilityRestored = false
        }
        bio.coef = biologyCoefficient(bio)
        this.pushChange(charChanges, player, BIOLOGY_CATEGORY, 0, 'replace', old, this.slotDisplay(player, BIOLOGY_CATEGORY, 0), bio.isVisible)
        return ok(card.action === 'rejuvenate' ? `${player.name}: возраст 25 лет` : `${player.name}: добавлено бесплодие`)
      }
      case 'change': {
        if (card.scope === 'all') {
          if (card.target === 'biology') {
            this.rerollBiologyAllTracked(charChanges)
            return ok('Пересдана биология всем игрокам')
          }
          let category = this.catToCategory(card.target)
          let occ = 0
          if (card.target === 'any') {
            const pick = t.categories?.[0]
            category = typeof pick === 'string' ? pick : (pick?.category ?? '')
            occ = typeof pick === 'string' ? 0 : (pick?.occ ?? 0)
            if (!category) return fail('Не выбрана категория')
          }
          if (category === BIOLOGY_CATEGORY) {
            this.rerollBiologyAllTracked(charChanges)
            return ok('Пересдана биология всем игрокам')
          }
          if (!this.replaceCategoryAllTracked(charChanges, category, occ)) {
            return fail(`Не удалось пересдать «${category}»`)
          }
          const label = this.slotLabel(category, occ, self)
          return ok(`Пересдана категория «${label}» всем игрокам`)
        }

        if (card.scope === 'self') {
          const ch = t.characteristics?.[0]
          if (!ch) return fail('Выберите характеристику для замены')
          const allowed =
            card.target === 'factItem'
              ? ['Факт', 'Багаж']
              : card.target === 'item'
                ? ['Багаж']
                : card.target === 'fact'
                  ? ['Факт']
                  : null
          if (allowed && !allowed.includes(ch.category)) {
            return fail('Можно заменить только указанные характеристики')
          }
          if (!this.applyTracked(charChanges, self, ch.category, ch.occ ?? 0)) {
            return fail('Не удалось заменить характеристику')
          }
          return ok(`Заменён ${this.slotLabel(ch.category, ch.occ ?? 0, self)}`)
        }

        if (card.target === 'lastOpened') {
          const otherId = t.players?.[0]
          if (!otherId || otherId === playerId) return fail('Выберите другого игрока')
          const pl = this.players.find((p) => p.id === otherId)
          if (!pl) return fail('Игрок не найден')
          const last = this.lastRevealed.get(otherId)
          if (!last) return fail('У игрока ещё нет открытых характеристик')
          if (!this.applyTracked(charChanges, pl, last.category, last.occ)) {
            return fail('Не удалось заменить последнюю открытую характеристику')
          }
          return ok(
            `Заменена последняя открытая характеристика ${this.nameOf(otherId)}: ${this.slotLabel(last.category, last.occ, pl)}`,
          )
        }

        const targetId = t.players?.[0]
        if (!targetId) return fail('Выберите игрока')
        const pl = this.players.find((p) => p.id === targetId)
        if (!pl) return fail('Игрок не найден')

        if (card.target !== 'any' && card.target !== 'factItem') {
          const category = this.catToCategory(card.target)
          const occ = t.characteristics?.[0]?.occ ?? 0
          if (!this.applyTracked(charChanges, pl, category, occ)) {
            return fail(`Не удалось заменить «${category}»`)
          }
          return ok(`Заменено — ${this.nameOf(targetId)}: ${this.slotLabel(category, occ, pl)}`)
        }

        const chars = t.characteristics ?? []
        if (chars.length === 0) return fail('Не выбраны характеристики')
        const names: string[] = []
        for (const ch of chars) {
          const owner = this.players.find((p) => p.id === ch.playerId) ?? pl
          if (this.applyTracked(charChanges, owner, ch.category, ch.occ ?? 0)) {
            names.push(`${this.nameOf(owner.id)}: ${this.slotLabel(ch.category, ch.occ ?? 0, owner)}`)
          }
        }
        if (names.length === 0) return fail('Не удалось заменить характеристики')
        return ok(`Заменено — ${names.join(', ')}`)
      }
      case 'swap': {
        const otherId = t.players?.[0]
        if (!otherId || otherId === playerId) return fail('Выберите другого игрока')
        const other = this.players.find((p) => p.id === otherId)
        if (!other) return fail('Игрок не найден')
        const give = t.characteristics?.[0]
        const receive = t.characteristics?.[1]
        if (!give || !receive) {
          return fail('Выберите, что отдаёте и что получаете')
        }
        if (give.playerId !== playerId || receive.playerId !== otherId) {
          return fail('Неверно выбраны владельцы характеристик')
        }
        if (give.category !== receive.category) {
          return fail('Обмен возможен только внутри одной категории')
        }
        const category = give.category
        if (card.target === 'item' && category !== 'Багаж') {
          return fail('Этой картой можно обменивать только багаж')
        }
        if (category === BIOLOGY_CATEGORY) {
          if (!self.biology || !other.biology) return fail('Нет биологии для обмена')
          if (!self.biology.isVisible || !other.biology.isVisible) {
            return fail('Обменивать можно только открытые характеристики')
          }
          const oldSelf = this.slotDisplay(self, BIOLOGY_CATEGORY, 0)
          const oldOther = this.slotDisplay(other, BIOLOGY_CATEGORY, 0)
          const visA = self.biology.isVisible
          const visB = other.biology.isVisible
          const tmp = { ...self.biology }
          self.biology = { ...other.biology, isVisible: visA }
          other.biology = { ...tmp, isVisible: visB }
          this.pushChange(charChanges, self, BIOLOGY_CATEGORY, 0, 'swap', oldSelf, this.slotDisplay(self, BIOLOGY_CATEGORY, 0), visA)
          this.pushChange(charChanges, other, BIOLOGY_CATEGORY, 0, 'swap', oldOther, this.slotDisplay(other, BIOLOGY_CATEGORY, 0), visB)
          return ok(`Обмен биологии с ${this.nameOf(otherId)}`)
        }
        const a = findChar(self.characteristics, category, give.occ ?? 0)
        const b = findChar(other.characteristics, category, receive.occ ?? 0)
        if (!a || !b) return fail('Не найдена выбранная характеристика')
        if (!a.isVisible || !b.isVisible) {
          return fail('Обменивать можно только открытые характеристики')
        }
        const oldA = formatCharacteristicValue(a)!
        const oldB = formatCharacteristicValue(b)!
        const tmp = { ...a, tags: [...(a.tags ?? [])] }
        a.value = b.value
        a.coef = b.coef
        a.hint = b.hint
        a.tags = [...(b.tags ?? [])]
        a.stageLabel = b.stageLabel
        a.stageIndex = b.stageIndex
        a.incurable = b.incurable
        b.value = tmp.value
        b.coef = tmp.coef
        b.hint = tmp.hint
        b.tags = tmp.tags
        b.stageLabel = tmp.stageLabel
        b.stageIndex = tmp.stageIndex
        b.incurable = tmp.incurable
        this.pushChange(charChanges, self, category, give.occ ?? 0, 'swap', oldA, formatCharacteristicValue(a)!, true)
        this.pushChange(charChanges, other, category, receive.occ ?? 0, 'swap', oldB, formatCharacteristicValue(b)!, true)
        return ok(
          `Обмен с ${this.nameOf(otherId)}: отдан «${this.slotLabel(category, give.occ ?? 0, self)}», получен «${this.slotLabel(category, receive.occ ?? 0, other)}»`,
        )
      }
      case 'healFertile': {
        const targetId = t.players?.[0] ?? playerId
        const healPl = this.players.find((p) => p.id === targetId)
        if (!healPl?.biology || healPl.biology.sex === 'Андроид') return fail('Нет биологии для лечения')
        if (healPl?.biology) {
          const oldValue = this.slotDisplay(healPl, BIOLOGY_CATEGORY, 0)
          const wasVisible = healPl.biology.isVisible
          healPl.biology.infertile = false
          healPl.biology.fertilityRestored = true
          healPl.biology.coef = biologyCoefficient(healPl.biology)
          this.pushChange(
            charChanges,
            healPl,
            BIOLOGY_CATEGORY,
            0,
            'healFertile',
            oldValue,
            this.slotDisplay(healPl, BIOLOGY_CATEGORY, 0),
            wasVisible,
          )
        }
        return ok(`Вылечено бесплодие: ${this.nameOf(targetId)}`)
      }
      case 'replayLast': {
        const previous = this.lastPlayedEffect
        if (!previous) return fail('Нет карты для повтора')
        if (previous.byPlayerId === playerId) {
          return fail('Можно повторить только карту другого игрока')
        }
        const copy: ActionCard = {
          ...previous.card,
          instanceId: `ci_${this.cardInstanceCounter++}`,
          pickSpecs: previous.card.pickSpecs.map((spec) => ({
            ...spec,
            categories: spec.categories ? [...spec.categories] : undefined,
          })),
          used: false,
        }
        const hand = this.cards.get(playerId) ?? []
        hand.push(copy)
        this.cards.set(playerId, hand)
        return ok(`Получена копия карты «${copy.title}» — её можно сыграть от своего лица`)
      }
      case 'changeCatastrophe': {
        const previous = this.bunker.catastrophe
        this.bunker.catastrophe = pickCatastrophe(this.gameMode())
        const fromTitle = challengeTitle(previous, this.gameMode())
        const toTitle = challengeTitle(this.bunker.catastrophe, this.gameMode())
        this.pushPublicChange(charChanges, 'Катастрофа', fromTitle, toTitle)
        return ok(`Катастрофа: ${fromTitle} → ${toTitle}`)
      }
      case 'revealCondition': {
        const cond = pickUnusedCondition(this.bunker.conditions.map((condition) => condition.text), this.gameMode())
        if (!cond) return fail('Все дополнительные условия уже открыты')
        const entry: StoredBunkerCondition = {
          text: cond,
          byPlayerId: playerId,
          byName: this.nameOf(playerId),
        }
        this.bunker.conditions.push(entry)
        const title = challengeTitle(cond, this.gameMode())
        this.pushPublicChange(charChanges, 'Доп. условие', 'не было', title)
        return ok(`Открыто доп. условие: ${title}`)
      }
      case 'removeThreat': {
        const idx = t.threats?.[0]
        if (idx === undefined || idx < 0 || idx >= this.bunker.threats.length)
          return fail('Выберите угрозу')
        const removed = this.bunker.threats.splice(idx, 1)[0]
        const title = challengeTitle(removed, this.gameMode())
        this.pushPublicChange(charChanges, 'Угроза', title, 'снята')
        return ok(`Убрана угроза: ${title}`)
      }
      case 'cancelVotes': {
        const ids = (t.players ?? []).slice(0, 2)
        if (ids.length === 0) return fail('Выберите игроков')
        ids.forEach((id) => this.cancelledVoters.add(id))
        return ok(`Голоса не учитываются: ${ids.map((i) => this.nameOf(i)).join(', ')}`)
      }
      case 'doubleVote': {
        const result = this.applyDoubleVote(playerId)
        return { ...result, charChanges }
      }
      case 'selfProtection': {
        const otherId = t.players?.[0]
        if (!otherId || otherId === playerId) return fail('Выберите другого игрока')
        this.voteBans.push({ voterId: otherId, protectedId: playerId })
        return ok(`${this.nameOf(otherId)} не может голосовать против ${this.nameOf(playerId)}`)
      }
      case 'selfDefence': {
        this.protectedFromVote.add(playerId)
        return ok(`Никто не может голосовать против ${this.nameOf(playerId)} в этом раунде`)
      }
      case 'revote': {
        if (!this.isVoting()) return fail('Только во время голосования')
        const originalTargetId = this.votes.get(playerId)
        const uniqueTargets = [...new Set(this.votes.values())]
        if (this.settings.voteMode === 'sequential') for (const [voterId, targetId] of this.votes) {
          const voter = this.players.find((p) => p.id === voterId)
          this.pushPublicChange(charChanges, 'Голос', this.nameOf(targetId), 'другой кандидат', voter)
        }
        this.revoteFrom = new Map(this.votes)
        this.votes.clear()
        this.broadcastVotes()
        if (this.settings.voteMode === 'sequential') this.beginSequentialVote()
        const originalName = originalTargetId
          ? this.nameOf(originalTargetId)
          : uniqueTargets.map((id) => this.nameOf(id)).join(', ')
        return ok(
          this.settings.voteMode === 'sequential' && originalName
            ? `Переголосование. Изначальный кандидат: ${originalName}`
            : 'Объявлено переголосование — выберите другого кандидата',
        )
      }
      default:
        return fail('Эффект этой карты не реализован')
    }
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
    this.turn = { ...this.turn, stepIndex: index }
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
    this.io.to(this.code).emit('bunkerUpdated', { bunker: toPublicBunker(this.bunker, this.gameMode()) })
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

  /**
   * Порядок живых игроков со стартовой позицией, сдвинутой на один исходный
   * слот для каждой следующей стадии того же типа. Выбывшие пропускаются, но
   * не сдвигают исходную «точку старта» следующих раундов.
   */
  private rotatedAliveOrder(kind: RoundStep['kind']): string[] {
    if (this.players.length === 0) return []
    let occurrence = 0
    for (let i = 0; i <= this.stepIndex && i < this.settings.roundSteps.length; i++) {
      if (this.settings.roundSteps[i].kind === kind) occurrence += 1
    }
    const order = this.matchOrder.length ? this.matchOrder : this.players.map(p => p.id)
    const offset = Math.max(0, occurrence - 1) % order.length
    return [...order.slice(offset), ...order.slice(0, offset)]
      .filter(id => this.players.some(p => p.id === id && p.isAlive))
  }

  private beginRevealStep(step: RoundStep): void {
    this.randomRevealStep = -1
    this.randomRevealRolled.clear()
    this.clearForcedReveal()
    this.stage = 'reveal'
    this.turnOrder = this.rotatedAliveOrder('reveal')
    this.turnIndex = 0
    this.turn = {
      currentPlayerId: null,
      stepIndex: this.stepIndex,
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
    this.clearForcedReveal()
    this.turnIndex = index
    const playerId = this.turnOrder[index]
    this.turnGraceGiven = false
    this.turn = { ...this.turn, currentPlayerId: playerId, revealedThisTurn: 0 }
    this.prepareForcedReveal()
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
        this.broadcastCharacters()
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
    if (this.forcedReveal && this.turn.currentPlayerId === playerId) {
      const before = this.turn.revealedThisTurn
      this.reveal(playerId, this.forcedReveal.category, this.forcedReveal.occ)
      return this.turn.revealedThisTurn > before
    }
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return false
    const hidden = player.characteristics.filter((c) => !c.isVisible)
    const bioHidden = player.biology && !player.biology.isVisible
    const total = hidden.length + (bioHidden ? 1 : 0)
    if (total === 0) return false
    let pick = Math.floor(Math.random() * total)
    if (bioHidden && pick === hidden.length) {
      player.biology!.isVisible = true
      this.lastRevealed.set(playerId, { category: BIOLOGY_CATEGORY, occ: 0 })
    } else {
      const ch = hidden[pick]
      ch.isVisible = true
      this.lastRevealed.set(playerId, { category: ch.type, occ: ch.occ ?? 0 })
    }
    this.turn.revealedThisTurn += 1
    this.pushCharacteristicsTo(playerId)
    this.broadcastCardHistory()
    return true
  }

  private advanceTurn(): void {
    if (this.stage !== 'reveal') return
    this.clearForcedReveal()
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
    const currentPlayerId = this.turn.currentPlayerId
    if (!currentPlayerId) return
    const isOwnTurn = currentPlayerId === playerId
    const isHostOverride = this.isHost(playerId) && !isOwnTurn
    if (!isOwnTurn && !isHostOverride) return
    if (this.turn.revealedThisTurn < 1 && isHostOverride) {
      if (this.revealRandomFor(currentPlayerId)) this.broadcastCharacters()
    }
    const currentPlayer = this.players.find(p => p.id === currentPlayerId)
    const hasHidden = currentPlayer?.characteristics.some(c => !c.isVisible) ||
      (currentPlayer?.biology && !currentPlayer.biology.isVisible)
    if (this.turn.revealedThisTurn < 1 && hasHidden) {
      this.emitError(playerId, 'Нужно вскрыть хотя бы одну характеристику, прежде чем завершить ход')
      return
    }
    this.advanceTurn()
  }

  // ─── Вскрытие характеристик ──────────────────────────────────────────────

  reveal(playerId: string, type: string, occ = 0, autoEndTurn = false): void {
    if (this.stage !== 'reveal') return
    if (this.turn.currentPlayerId !== playerId) return
    if (this.turn.revealedThisTurn >= this.turn.revealsThisTurn) return
    if (this.forcedReveal && (type !== this.forcedReveal.category || occ !== this.forcedReveal.occ)) return

    const player = this.players.find((p) => p.id === playerId)
    if (!player) return

    let ok = false
    if (type === BIOLOGY_CATEGORY) {
      if (player.biology && !player.biology.isVisible) {
        player.biology.isVisible = true
        this.lastRevealed.set(playerId, { category: BIOLOGY_CATEGORY, occ: 0 })
        ok = true
      }
    } else {
      const char = findChar(player.characteristics, type, occ)
      if (char && !char.isVisible) {
        char.isVisible = true
        this.lastRevealed.set(playerId, { category: char.type, occ: char.occ ?? 0 })
        ok = true
      }
    }
    if (!ok) return

    this.turn.revealedThisTurn += 1
    this.clearForcedReveal()
    this.broadcastCharacters()
    this.pushCharacteristicsTo(playerId)
    this.broadcastCardHistory()
    if (autoEndTurn) {
      this.advanceTurn()
      return
    }
    this.io.to(this.code).emit('turnChanged', {
      turn: this.turn,
      timer: this.timer,
      isPaused: this.isPaused,
    })
  }

  private pushCharacteristicsTo(playerId: string): void {
    const player = this.players.find((p) => p.id === playerId)
    const sid = this.sockets.get(playerId)
    if (!sid || !player?.biology) return
    this.io.to(sid).emit('yourCharacteristics', {
      characteristics: player.characteristics,
      biology: player.biology,
    })
  }

  private sendForcedReveal(playerId: string): void {
    const sid = this.sockets.get(playerId)
    if (sid) this.io.to(sid).emit('forcedRevealChanged', {
      slot: this.stage === 'reveal' && this.turn.currentPlayerId === playerId ? this.forcedReveal : null,
    })
  }

  private clearForcedReveal(): void {
    this.forcedReveal = null
    if (this.turn.currentPlayerId) this.sendForcedReveal(this.turn.currentPlayerId)
  }

  private prepareForcedReveal(): void {
    const id = this.turn.currentPlayerId
    if (this.stage !== 'reveal' || this.randomRevealStep !== this.stepIndex || !id ||
      this.turn.revealedThisTurn > 0 || this.randomRevealRolled.has(id)) return
    this.randomRevealRolled.add(id)
    const player = this.alive().find(p => p.id === id)
    if (!player) return
    const hidden = player.characteristics.filter(c => !c.isVisible).map(c => ({ category: c.type, occ: c.occ ?? 0 }))
    if (player.biology && !player.biology.isVisible) hidden.push({ category: BIOLOGY_CATEGORY, occ: 0 })
    if (hidden.length && Math.random() < 0.75) this.forcedReveal = hidden[Math.floor(Math.random() * hidden.length)]
    this.sendForcedReveal(id)
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
    this.revoteFrom.clear()
    this.voteInterrupts = []
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

  // Поочерёдное голосование: стартовый игрок сдвигается в каждом новом голосовании.
  private voteOrder: string[] = []
  private voteOrderIndex = 0

  private beginSequentialVote(): void {
    this.voteOrder = this.rotatedAliveOrder('vote')
    this.voteOrderIndex = 0
    this.voteInterrupts = []
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
      const targets = this.allowedVoteTargets(voterId)
      if (targets.length > 0) {
        this.votes.set(voterId, targets[Math.floor(Math.random() * targets.length)].id)
        this.broadcastVotes()
      }
    }
    this.advanceVoter()
  }

  private advanceVoter(): void {
    if (!this.isVoting() || this.settings.voteMode !== 'sequential') return

    const interrupted = this.voteInterrupts[this.voteInterrupts.length - 1]
    if (interrupted?.rewoundVoterId === this.turn.currentVoterId) {
      this.voteInterrupts.pop()
      let resumeIndex = this.voteOrder.indexOf(interrupted.resumeVoterId)
      if (
        resumeIndex < 0 ||
        !this.players.some((p) => p.id === interrupted.resumeVoterId && p.isAlive)
      ) {
        resumeIndex = this.voteOrder.findIndex(
          (id, index) =>
            index >= interrupted.resumeIndex &&
            !this.votes.has(id) &&
            this.players.some((p) => p.id === id && p.isAlive),
        )
      }
      if (resumeIndex >= 0) {
        this.startVoterTurn(resumeIndex)
        return
      }
      this.finishVote()
      return
    }

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

  /** Допустимые цели голоса с учётом защиты и запрета повторного выбора. */
  private allowedVoteTargets(voterId: string): Player[] {
    let pool = this.candidatePool().filter((p) => p.id !== voterId)
    pool = pool.filter((p) => !this.protectedFromVote.has(p.id))
    pool = pool.filter(
      (p) => !this.voteBans.some((b) => b.voterId === voterId && b.protectedId === p.id),
    )
    const prev = this.revoteFrom.get(voterId)
    if (prev && pool.length > 1) {
      pool = pool.filter((p) => p.id !== prev)
    }
    return pool
  }

  vote(voterId: string, targetId: string): void {
    if (!this.isVoting()) return
    const voter = this.players.find((p) => p.id === voterId)
    const target = this.players.find((p) => p.id === targetId)
    if (!voter?.isAlive || !target?.isAlive) return
    if (voterId === targetId) return
    if (this.voteCandidates && !this.voteCandidates.includes(targetId)) return
    if (this.protectedFromVote.has(targetId)) {
      this.emitError(voterId, 'Этот игрок защищён от голосов в этом раунде')
      return
    }
    if (this.voteBans.some((b) => b.voterId === voterId && b.protectedId === targetId)) {
      this.emitError(voterId, 'Вы не можете голосовать против этого игрока')
      return
    }
    const allowed = this.allowedVoteTargets(voterId)
    if (!allowed.some((p) => p.id === targetId)) {
      const prev = this.revoteFrom.get(voterId)
      if (prev === targetId && this.candidatePool().filter((p) => p.id !== voterId).length > 1) {
        this.emitError(voterId, 'При переголосовании нужно выбрать другого кандидата')
      }
      return
    }

    // Поочерёдный режим: голосовать может только текущий голосующий.
    if (this.settings.voteMode === 'sequential') {
      if (this.turn.currentVoterId !== voterId) return
      this.votes.set(voterId, targetId)
      this.broadcastVotes()
      this.advanceVoter()
      return
    }

    this.votes.set(voterId, targetId)
    this.broadcastVotes()
    this.finishIfEveryoneVoted()
  }

  private tally(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [voterId, targetId] of this.votes.entries()) {
      // Карты: аннулированные голоса не учитываются.
      if (this.cancelledVoters.has(voterId)) continue
      const weight = this.voteWeight.get(voterId) ?? 1
      result[targetId] = (result[targetId] || 0) + weight
    }
    return result
  }
  private votesByTarget(): Record<string, string[]> {
    const result: Record<string, string[]> = {}
    for (const [voterId, targetId] of this.votes.entries()) (result[targetId] ??= []).push(voterId)
    return result
  }
  private finishIfEveryoneVoted(): void {
    const alive = this.alive()
    if (this.isVoting() && this.settings.voteMode !== 'sequential'
      && alive.length > 0 && alive.every(p => this.votes.has(p.id))) this.finishVote()
  }

  private broadcastVotes(): void {
    const secret = this.settings.voteMode !== 'sequential'
    for (const player of this.players) {
      const sid = this.socketOf(player.id)
      if (!sid) continue
      const previous = secret
        ? [...this.revoteFrom].filter(([id]) => id === player.id)
        : [...this.revoteFrom]
      this.io.to(sid).emit('votesUpdated', {
        candidates: this.voteCandidates,
        tally: secret ? {} : this.tally(),
        voted: [...this.votes.keys()],
        votesByTarget: secret ? {} : this.votesByTarget(),
        revoteFrom: Object.fromEntries(previous),
        ownVote: this.votes.get(player.id) ?? null,
      })
    }
  }

  private fillRandomVotes(): void {
    for (const voter of this.alive()) {
      if (this.votes.has(voter.id)) continue
      const targets = this.allowedVoteTargets(voter.id)
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
    this.voteInterrupts = []
    this.turn = { ...this.turn, currentVoterId: null }

    const tally = this.tally()
    const votesByTarget = this.votesByTarget()
    const cancelledVoters = [...this.cancelledVoters]
    const entries = Object.entries(tally)

    const max = entries.length > 0 ? Math.max(...entries.map(([, c]) => c)) : 0
    const leaders: string[] = entries.length > 0
      ? entries.filter(([, c]) => c === max).map(([id]) => id)
      : []
    if (entries.length === 0) {
      const noVotePool = this.candidatePool()
      const randomCandidate = noVotePool[Math.floor(Math.random() * noVotePool.length)]
      if (randomCandidate) leaders.push(randomCandidate.id)
    }

    if (leaders.length === 0) {
      this.publishVoteResult({ eliminatedId: null, tie: false, tiedIds: [], tally, votesByTarget, cancelledVoters })
      this.nextStep()
      return
    }

    if (entries.length > 0 && leaders.length > 1 && this.stage === 'vote1') {
      this.publishVoteResult({ eliminatedId: null, tie: true, tiedIds: leaders, tally })
      this.stage = 'vote2'
      this.votes.clear()
      this.revoteFrom.clear()
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
      this.matchRecorder?.eliminate(eliminated.id)
      // III.1: у исключённого раскрываются все характеристики.
      eliminated.characteristics.forEach((c) => (c.isVisible = true))
      if (eliminated.biology) eliminated.biology.isVisible = true
    }

    this.votes.clear()
    this.voteCandidates = null
    this.revoteFrom.clear()
    // Карты: одноразовые модификаторы голосования сработали — сбрасываем.
    this.resetRoundVoteModifiers()
    this.publishVoteResult({ eliminatedId, tie: false, tiedIds: [], tally, votesByTarget, cancelledVoters })
    this.broadcastPlayers()
    this.broadcastCharacters()
    this.broadcastCardHistory()

    if (this.checkWinCondition()) return
    this.nextStep()
  }

  private publishVoteResult(result: VoteResultPayload): void {
    this.lastVoteResult = result
    this.io.to(this.code).emit('voteResult', result)
  }

  /** Сбрасывает однораундовые эффекты карт (аннуляция/вес/защита). voteBans — постоянные. */
  private resetRoundVoteModifiers(): void {
    this.cancelledVoters.clear()
    this.voteWeight.clear()
    this.protectedFromVote.clear()
    this.voteInterrupts = []
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
    enqueueMatch(this.matchRecorder?.finish(this.alive().map(p => p.id)) ?? null)
    this.stopTimer()
    this.stage = 'end'
    this.turn = { ...this.turn, currentPlayerId: null, currentVoterId: null }
    // На конце игры раскрываем всё у всех.
    for (const p of this.players) {
      p.characteristics.forEach((c) => (c.isVisible = true))
      if (p.biology) p.biology.isVisible = true
    }
    this.survivalReport = calculateSurvival(this.players, this.bunker, this.gameMode())
    this.io.to(this.code).emit('gameEnded', {
      survivorIds: this.alive().map((p) => p.id),
      players: this.publicPlayers(),
      survival: this.survivalReport,
    })
    this.broadcastCharacters()
    this.broadcastCardHistory()
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

  private playersInMatchOrder(): Player[] {
    if (!this.matchOrder.length) return this.players
    return [...this.players].sort((a, b) => this.matchOrder.indexOf(a.id) - this.matchOrder.indexOf(b.id))
  }

  private publicPlayers(viewerId?: string): PublicPlayer[] {
    const viewer = viewerId ? this.players.find((p) => p.id === viewerId) : undefined
    const revealAll = this.stage === 'end' || viewer?.isAlive === false
    return this.playersInMatchOrder().map((p) => ({
      id: p.id,
      name: p.name,
      isAlive: p.isAlive,
      connected: p.connected,
      characteristics: revealAll ? p.characteristics : p.characteristics.filter((c) => c.isVisible),
      avatarUrl: p.avatarUrl,
      biology: revealAll ? p.biology : p.biology?.isVisible ? p.biology : null,
    }))
  }

  /** Выбывшие игроки получают spectator-представление со всеми характеристиками. */
  private broadcastCharacters(): void {
    for (const player of this.players) {
      const sid = this.sockets.get(player.id)
      if (sid) {
        this.io.to(sid).emit('charactersUpdated', { players: this.publicPlayers(player.id) })
      }
    }
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
        avatarUrl: p.avatarUrl,
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
    this.io.to(sid).emit('yourCards', { cards: this.cards.get(playerId) ?? [] })
    this.sendForcedReveal(playerId)
    this.io.to(sid).emit('gameStarted', {
      players: this.publicPlayers(playerId),
      stage: this.stage,
      settings: this.settings,
      turn: this.turn,
      bunker: toPublicBunker(this.bunker, this.gameMode()),
      actionCards: [],
      charLayout: this.charLayout,
      cardHistory: this.cardHistoryFor(playerId),
    })
    this.io.to(sid).emit('bunkerUpdated', { bunker: toPublicBunker(this.bunker, this.gameMode()) })
    this.io.to(sid).emit('stageChanged', {
      stage: this.stage,
      timer: this.timer,
      isPaused: this.isPaused,
      turn: this.turn,
    })
    if (this.isVoting()) this.broadcastVotes()
    if (this.lastVoteResult) this.io.to(sid).emit('voteResult', this.lastVoteResult)
    if (this.stage === 'end') {
      this.survivalReport ??= calculateSurvival(this.players, this.bunker, this.gameMode())
      this.io.to(sid).emit('gameEnded', {
        survivorIds: this.alive().map((p) => p.id),
        players: this.publicPlayers(playerId),
        survival: this.survivalReport,
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
    const lobby = new Lobby(this.io, code, () => this.remove(code))
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

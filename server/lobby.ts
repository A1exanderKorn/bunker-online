import type { Server } from 'socket.io'
import type {
  ActionCard,
  Biology,
  BunkerCondition,
  BunkerState,
  CardTargets,
  CharSlot,
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
import { dealCharacteristics, buildCharLayout, findChar, generateBiology } from './characteristics'
import { rowsByCategory } from './data'
import { pickCatastrophe, threatQueue, loadBunkerData } from './bunker'
import { dealActionCards, makeCardByCatalogId, loadCards } from './cards'

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
  private bunker: BunkerState = { catastrophe: '', years: 0, threats: [], conditions: [] }
  private pendingThreats: string[] = []
  private charLayout: CharSlot[] = []

  // ── Карты действия ──
  /** playerId -> карты игрока. */
  private cards = new Map<string, ActionCard[]>()
  /** Последняя сыгранная карта (для replayLast). */
  private lastPlayedCode: string | null = null
  private cardInstanceCounter = 1000
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
      actionCardsEnabled: !!s.actionCardsEnabled,
      cardsPower: s.cardsPower === 'weak' || s.cardsPower === 'strong' ? s.cardsPower : 'balanced',
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
      conditions: [],
    }
    this.charLayout = buildCharLayout(this.settings)
    this.lastRevealed.clear()
    this.revoteFrom.clear()

    // Раздаём карты действия, если включены.
    this.cards.clear()
    this.lastPlayedCode = null
    this.cancelledVoters.clear()
    this.voteWeight.clear()
    this.protectedFromVote.clear()
    this.voteBans = []
    if (this.settings.actionCardsEnabled) {
      const dealt = dealActionCards(this.players, this.settings.cardsPower)
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
      bunker: this.bunker,
      actionCards: [],
      charLayout: this.charLayout,
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
    this.bunker = { catastrophe: '', years: 0, threats: [], conditions: [] }
    this.pendingThreats = []
    this.cards.clear()
    this.lastPlayedCode = null
    this.lastRevealed.clear()
    this.revoteFrom.clear()
    this.charLayout = []
    this.cancelledVoters.clear()
    this.voteWeight.clear()
    this.protectedFromVote.clear()
    this.voteBans = []
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

  private randomCharValue(category: string): { value: string; coef: number; hint: string } | null {
    const rows = rowsByCategory(category)
    if (!rows || rows.length === 0) return null
    const r = rows[Math.floor(Math.random() * rows.length)]
    return { value: String(r['Название']), coef: Number(r['КФ']) || 0, hint: String(r['Подсказка'] ?? '') }
  }

  private replaceChar(pl: Player, category: string, occ = 0): boolean {
    if (category === BIOLOGY_CATEGORY) return this.rerollBiology(pl)
    const rc = this.randomCharValue(category)
    if (!rc) return false
    const ch = findChar(pl.characteristics, category, occ)
    if (!ch) return false
    ch.value = rc.value
    ch.coef = rc.coef
    ch.hint = rc.hint
    return true
  }

  private rerollBiology(pl: Player): boolean {
    const others = this.players.filter((p) => p.id !== pl.id && p.biology).map((p) => p.biology!)
    const visible = pl.biology?.isVisible ?? false
    const bio = generateBiology(others)
    bio.isVisible = visible
    pl.biology = bio
    return true
  }

  private rerollBiologyAll(): void {
    const newBios: Biology[] = []
    for (const pl of this.alive()) {
      const visible = pl.biology?.isVisible ?? false
      const bio = generateBiology(newBios)
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
    if (!this.started) return
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

    const effect = this.applyCardEffect(playerId, card, targets)
    if (!effect.ok) {
      this.emitError(playerId, effect.error ?? 'Неверные цели карты')
      return
    }

    card.used = true
    this.lastPlayedCode = card.code
    this.sendCardsTo(playerId)

    const byName = this.players.find((p) => p.id === playerId)?.name ?? '?'
    this.io.to(this.code).emit('cardPlayed', {
      byPlayerId: playerId,
      byName,
      title: card.title,
      effectText: effect.text ?? card.title,
    })
    // Обновляем публичное состояние и бункер.
    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })
    this.io.to(this.code).emit('bunkerUpdated', { bunker: this.bunker })
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

  /** Имена игроков по id (для текста эффекта). */
  private nameOf(id: string): string {
    return this.players.find((p) => p.id === id)?.name ?? '?'
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
   * Применяет эффект карты. Возвращает {ok, text?, error?}.
   */
  private applyCardEffect(
    playerId: string,
    card: ActionCard,
    t: CardTargets,
  ): { ok: boolean; text?: string; error?: string } {
    const self = this.players.find((p) => p.id === playerId)
    if (!self) return { ok: false, error: 'Игрок не найден' }

    switch (card.action) {
      case 'change': {
        if (card.scope === 'all') {
          if (card.target === 'biology') {
            this.rerollBiologyAll()
            return { ok: true, text: 'Пересдана биология всем игрокам' }
          }
          let category = this.catToCategory(card.target)
          let occ = 0
          if (card.target === 'any') {
            const pick = t.categories?.[0]
            category = typeof pick === 'string' ? pick : (pick?.category ?? '')
            occ = typeof pick === 'string' ? 0 : (pick?.occ ?? 0)
            if (!category) return { ok: false, error: 'Не выбрана категория' }
          }
          if (category === BIOLOGY_CATEGORY) {
            this.rerollBiologyAll()
            return { ok: true, text: 'Пересдана биология всем игрокам' }
          }
          let okAny = false
          for (const pl of this.alive()) {
            if (this.replaceChar(pl, category, occ)) okAny = true
          }
          if (!okAny) return { ok: false, error: `Не удалось пересдать «${category}»` }
          const label = this.slotLabel(category, occ, self)
          return { ok: true, text: `Пересдана категория «${label}» всем игрокам` }
        }

        if (card.scope === 'self') {
          const ch = t.characteristics?.[0]
          if (!ch) return { ok: false, error: 'Выберите характеристику для замены' }
          const allowed =
            card.target === 'factItem'
              ? ['Факт', 'Багаж']
              : card.target === 'item'
                ? ['Багаж']
                : card.target === 'fact'
                  ? ['Факт']
                  : null
          if (allowed && !allowed.includes(ch.category)) {
            return { ok: false, error: 'Можно заменить только указанные характеристики' }
          }
          if (!this.applySlot(self, ch.category, ch.occ ?? 0)) {
            return { ok: false, error: 'Не удалось заменить характеристику' }
          }
          return { ok: true, text: `Заменён ${this.slotLabel(ch.category, ch.occ ?? 0, self)}` }
        }

        if (card.target === 'lastOpened') {
          const otherId = t.players?.[0]
          if (!otherId || otherId === playerId) return { ok: false, error: 'Выберите другого игрока' }
          const pl = this.players.find((p) => p.id === otherId)
          if (!pl) return { ok: false, error: 'Игрок не найден' }
          const last = this.lastRevealed.get(otherId)
          if (!last) return { ok: false, error: 'У игрока ещё нет открытых характеристик' }
          if (!this.applySlot(pl, last.category, last.occ)) {
            return { ok: false, error: 'Не удалось заменить последнюю открытую характеристику' }
          }
          return {
            ok: true,
            text: `Заменена последняя открытая характеристика ${this.nameOf(otherId)}: ${this.slotLabel(last.category, last.occ, pl)}`,
          }
        }

        const targetId = t.players?.[0]
        if (!targetId) return { ok: false, error: 'Выберите игрока' }
        const pl = this.players.find((p) => p.id === targetId)
        if (!pl) return { ok: false, error: 'Игрок не найден' }

        if (card.target !== 'any' && card.target !== 'factItem') {
          const category = this.catToCategory(card.target)
          const occ = t.characteristics?.[0]?.occ ?? 0
          if (!this.applySlot(pl, category, occ)) {
            return { ok: false, error: `Не удалось заменить «${category}»` }
          }
          return {
            ok: true,
            text: `Заменено — ${this.nameOf(targetId)}: ${this.slotLabel(category, occ, pl)}`,
          }
        }

        const chars = t.characteristics ?? []
        if (chars.length === 0) return { ok: false, error: 'Не выбраны характеристики' }
        const names: string[] = []
        for (const ch of chars) {
          const owner = this.players.find((p) => p.id === ch.playerId) ?? pl
          if (this.applySlot(owner, ch.category, ch.occ ?? 0)) {
            names.push(`${this.nameOf(owner.id)}: ${this.slotLabel(ch.category, ch.occ ?? 0, owner)}`)
          }
        }
        if (names.length === 0) return { ok: false, error: 'Не удалось заменить характеристики' }
        return { ok: true, text: `Заменено — ${names.join(', ')}` }
      }
      case 'swap': {
        const otherId = t.players?.[0]
        if (!otherId || otherId === playerId) return { ok: false, error: 'Выберите другого игрока' }
        const other = this.players.find((p) => p.id === otherId)
        if (!other) return { ok: false, error: 'Игрок не найден' }
        const pick = t.characteristics?.[0]
        const category = card.target === 'item' ? 'Багаж' : pick?.category
        const occ = pick?.occ ?? 0
        if (!category) return { ok: false, error: 'Не выбрана характеристика' }
        if (category === BIOLOGY_CATEGORY) {
          if (!self.biology || !other.biology) return { ok: false, error: 'Нет биологии для обмена' }
          const tmp = { ...self.biology }
          const visA = self.biology.isVisible
          const visB = other.biology.isVisible
          self.biology = { ...other.biology, isVisible: visA }
          other.biology = { ...tmp, isVisible: visB }
          return { ok: true, text: `Обмен биологии с ${this.nameOf(otherId)}` }
        }
        const a = findChar(self.characteristics, category, occ)
        const b = findChar(other.characteristics, category, occ)
        if (!a || !b) return { ok: false, error: 'Нет такой характеристики у обоих игроков' }
        const tmp = { value: a.value, coef: a.coef, hint: a.hint }
        a.value = b.value
        a.coef = b.coef
        a.hint = b.hint
        b.value = tmp.value
        b.coef = tmp.coef
        b.hint = tmp.hint
        return {
          ok: true,
          text: `Обмен «${this.slotLabel(category, occ, self)}» с ${this.nameOf(otherId)}`,
        }
      }
      case 'healFertile': {
        const targetId = t.players?.[0] ?? playerId
        const pl = this.players.find((p) => p.id === targetId)
        if (pl?.biology) {
          pl.biology.infertile = false
          pl.biology.coef += 0.4
        }
        return { ok: true, text: `Вылечено бесплодие: ${this.nameOf(targetId)}` }
      }
      case 'replayLast': {
        return { ok: true, text: this.lastPlayedCode ? 'Повтор последней карты' : 'Нет карты для повтора' }
      }
      case 'changeCatastrophe': {
        this.bunker.catastrophe = pickCatastrophe()
        return { ok: true, text: 'Катастрофа изменена' }
      }
      case 'revealCondition': {
        const data = loadBunkerData()
        if (data.conditions.length === 0) return { ok: false, error: 'В колоде нет доп. условий' }
        const cond = data.conditions[Math.floor(Math.random() * data.conditions.length)]
        const entry: BunkerCondition = {
          text: cond,
          byPlayerId: playerId,
          byName: this.nameOf(playerId),
        }
        this.bunker.conditions.push(entry)
        return { ok: true, text: 'Открыто доп. условие бункера' }
      }
      case 'removeThreat': {
        const idx = t.threats?.[0]
        if (idx === undefined || idx < 0 || idx >= this.bunker.threats.length)
          return { ok: false, error: 'Выберите угрозу' }
        const removed = this.bunker.threats.splice(idx, 1)[0]
        return { ok: true, text: `Убрана угроза: ${removed.slice(0, 40)}…` }
      }
      case 'cancelVotes': {
        const ids = (t.players ?? []).slice(0, 2)
        if (ids.length === 0) return { ok: false, error: 'Выберите игроков' }
        ids.forEach((id) => this.cancelledVoters.add(id))
        return { ok: true, text: `Голоса не учитываются: ${ids.map((i) => this.nameOf(i)).join(', ')}` }
      }
      case 'doubleVote': {
        this.voteWeight.set(playerId, 2)
        return { ok: true, text: `Голос ${this.nameOf(playerId)} считается за два` }
      }
      case 'selfProtection': {
        const otherId = t.players?.[0]
        if (!otherId || otherId === playerId) return { ok: false, error: 'Выберите другого игрока' }
        this.voteBans.push({ voterId: otherId, protectedId: playerId })
        return { ok: true, text: `${this.nameOf(otherId)} не может голосовать против ${this.nameOf(playerId)}` }
      }
      case 'selfDefence': {
        this.protectedFromVote.add(playerId)
        return { ok: true, text: `Никто не может голосовать против ${this.nameOf(playerId)} в этом раунде` }
      }
      case 'revote': {
        if (!this.isVoting()) return { ok: false, error: 'Только во время голосования' }
        this.revoteFrom = new Map(this.votes)
        this.votes.clear()
        this.broadcastVotes()
        if (this.settings.voteMode === 'sequential') this.beginSequentialVote()
        return { ok: true, text: 'Объявлено переголосование — выберите другого кандидата' }
      }
      default:
        return { ok: true, text: card.title }
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
      this.lastRevealed.set(playerId, { category: BIOLOGY_CATEGORY, occ: 0 })
    } else {
      const ch = hidden[pick]
      ch.isVisible = true
      this.lastRevealed.set(playerId, { category: ch.type, occ: ch.occ ?? 0 })
    }
    this.turn.revealedThisTurn += 1
    this.pushCharacteristicsTo(playerId)
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

  reveal(playerId: string, type: string, occ = 0): void {
    if (this.stage !== 'reveal') return
    if (this.turn.currentPlayerId !== playerId) return
    if (this.turn.revealedThisTurn >= this.turn.revealsThisTurn) return

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
    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })
    this.pushCharacteristicsTo(playerId)
    this.io.to(this.code).emit('turnChanged', {
      turn: this.turn,
      timer: this.timer,
      isPaused: this.isPaused,
    })
    // П.2: ход НЕ завершается автоматически после вскрытия —
    // только по кнопке «Завершить ход» или по истечении таймера.
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
  private broadcastVotes(): void {
    const revoteFrom: Record<string, string> = {}
    for (const [k, v] of this.revoteFrom.entries()) revoteFrom[k] = v
    this.io.to(this.code).emit('votesUpdated', {
      tally: this.tally(),
      voted: [...this.votes.keys()],
      votesByTarget: this.votesByTarget(),
      revoteFrom: Object.keys(revoteFrom).length ? revoteFrom : undefined,
    })
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
      // III.1: у исключённого раскрываются все характеристики.
      eliminated.characteristics.forEach((c) => (c.isVisible = true))
      if (eliminated.biology) eliminated.biology.isVisible = true
    }

    this.votes.clear()
    this.voteCandidates = null
    this.revoteFrom.clear()
    // Карты: одноразовые модификаторы голосования сработали — сбрасываем.
    this.resetRoundVoteModifiers()
    this.io.to(this.code).emit('voteResult', { eliminatedId, tie: false, tiedIds: [], tally })
    this.broadcastPlayers()
    this.io.to(this.code).emit('charactersUpdated', { players: this.publicPlayers() })

    if (this.checkWinCondition()) return
    this.nextStep()
  }

  /** Сбрасывает однораундовые эффекты карт (аннуляция/вес/защита). voteBans — постоянные. */
  private resetRoundVoteModifiers(): void {
    this.cancelledVoters.clear()
    this.voteWeight.clear()
    this.protectedFromVote.clear()
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
    this.io.to(sid).emit('yourCards', { cards: this.cards.get(playerId) ?? [] })
    this.io.to(sid).emit('gameStarted', {
      players: this.publicPlayers(),
      stage: this.stage,
      settings: this.settings,
      turn: this.turn,
      bunker: this.bunker,
      actionCards: [],
      charLayout: this.charLayout,
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

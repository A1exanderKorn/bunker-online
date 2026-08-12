/**
 * Общие типы для сервера и фронтенда.
 * Единственный источник правды по доменной модели и контракту socket-событий.
 */

// ─── Доменная модель ────────────────────────────────────────────────────────

export type Sex = 'М' | 'Ж' | 'Андроид' | 'Гермафродит'

/** Категории характеристик (совпадают со значениями в data.xlsx). */
export const CHARACTERISTIC_CATEGORIES = [
  'Профессия',
  'Здоровье',
  'Хобби',
  'Фобия',
  'Багаж',
  'Факт',
] as const

export type CharacteristicCategory = (typeof CHARACTERISTIC_CATEGORIES)[number]

/** Псевдо-категория для строки биологии в таблице. */
export const BIOLOGY_CATEGORY = 'Биология' as const

export interface Characteristic {
  type: CharacteristicCategory
  value: string
  coef: number
  hint: string
  isVisible: boolean
}

export interface Biology {
  sex: Sex
  age: number
  experience: number
  coef: number
  infertile: boolean
  isVisible: boolean
  hint?: string
}

/** Полные данные игрока (живут только на сервере). */
export interface Player {
  id: string
  name: string
  characteristics: Characteristic[]
  biology: Biology | null
  isAlive: boolean
  connected: boolean
}

/**
 * Публичное представление игрока для остальных участников.
 * Содержит только вскрытые характеристики.
 */
export interface PublicPlayer {
  id: string
  name: string
  isAlive: boolean
  connected: boolean
  characteristics: Characteristic[]
  biology: Biology | null
}

// ─── Настройки лобби ──────────────────────────────────────────────────────

/**
 * Гибкие настройки игры, задаются хостом до старта.
 * Значения по умолчанию соответствуют классическим правилам «Бункера».
 */
export interface LobbySettings {
  /** Секунды на ход одного игрока (вскрытие одной характеристики). */
  turnSeconds: number
  /** Секунды на один круг голосования. */
  voteSeconds: number
  /** Целевой средний коэффициент набора характеристик (баланс псевдорандома). */
  targetCoef: number
  /**
   * Сколько игроков остаётся в конце (проходят в бункер).
   * Классически — половина от начального состава.
   * 0 => вычисляется автоматически как половина.
   */
  survivorsCount: number

  /** Режим голосования (III.2). */
  voteMode: VoteMode
  /** Секунды на обоснование+голос одного игрока в поочерёдном режиме. */
  sequentialVoteSeconds: number
  /** III.3: доп. багаж — 8-я характеристика (второй «Багаж»). */
  extraBaggage: boolean
  /** III.4: без фобий — категория «Фобия» не раздаётся. */
  noPhobias: boolean

  /** III.5: показывать ли угрозы (можно отключить). */
  threatsEnabled: boolean

  /** Карты действия: включены ли. Каждому игроку выдаётся 1 карта по КФ. */
  actionCardsEnabled: boolean
  /** Влияние карт: сдвиг вероятностей категорий. */
  cardsPower: CardsPower

  /**
   * Пошаговая программа раундов (II.5). Последовательность шагов:
   * вскрытие N характеристик либо голосование. Если список закончился,
   * а игра не завершена — повторяется последний цикл (вскрытие+голосование).
   */
  roundSteps: RoundStep[]
}

export type VoteMode = 'simultaneous' | 'sequential'

export const VOTE_MODE_LABELS: Record<VoteMode, string> = {
  simultaneous: 'Одновременное',
  sequential: 'Поочерёдное',
}

/** Влияние карт действия (сдвиг вероятностей категорий). */
export type CardsPower = 'weak' | 'balanced' | 'strong'

export const CARDS_POWER_LABELS: Record<CardsPower, string> = {
  weak: 'Слабые',
  balanced: 'Баланс',
  strong: 'Сильные',
}

/**
 * Один шаг игровой программы.
 * reveal-шаг = каждый игрок вскрывает ровно 1 характеристику.
 * «2 мирных раунда» = два отдельных reveal-шага подряд.
 */
export interface RoundStep {
  /** Тип шага: вскрытие (1 хар-ка) или голосование. */
  kind: 'reveal' | 'vote'
  /** Раскрыть ли угрозу в начале этого шага (только если threatsEnabled). */
  revealThreat: boolean
}

export const DEFAULT_SETTINGS: LobbySettings = {
  turnSeconds: 60,
  voteSeconds: 60,
  targetCoef: 0.5,
  survivorsCount: 0,
  voteMode: 'simultaneous',
  sequentialVoteSeconds: 30,
  extraBaggage: false,
  noPhobias: false,
  threatsEnabled: true,
  actionCardsEnabled: false,
  cardsPower: 'balanced',
  roundSteps: [],
}

/** Ограничения для валидации настроек на сервере. */
export const SETTINGS_LIMITS = {
  turnSeconds: { min: 10, max: 600 },
  voteSeconds: { min: 10, max: 600 },
  sequentialVoteSeconds: { min: 10, max: 300 },
  targetCoef: { min: 0, max: 1.5 },
  survivorsCount: { min: 0, max: 16 },
  maxSteps: 40,
} as const

/** Количество характеристик на игрока (7 базовых; +1 при extraBaggage, -1 при noPhobias). */
export function characteristicsCount(s: Pick<LobbySettings, 'extraBaggage' | 'noPhobias'>): number {
  return 7 + (s.extraBaggage ? 1 : 0) - (s.noPhobias ? 1 : 0)
}

/**
 * Генерирует программу раундов по умолчанию (логика из ТЗ):
 *   2 вскрытия → голосование → while(не осталась половина){ 1 вскрытие+угроза → голосование }
 * playerCount и survivors задают, сколько циклов голосования нужно (сколько исключений).
 */
export function defaultRoundSteps(playerCount: number, survivors: number): RoundStep[] {
  const eliminations = Math.max(0, playerCount - survivors)
  const steps: RoundStep[] = []
  if (eliminations <= 0) return steps
  // Первый цикл: 2 мирных раунда вскрытия → голосование.
  steps.push({ kind: 'reveal', revealThreat: false })
  steps.push({ kind: 'reveal', revealThreat: false })
  steps.push({ kind: 'vote', revealThreat: false })
  // Остальные исключения: 1 вскрытие+угроза → голосование.
  for (let i = 1; i < eliminations; i++) {
    steps.push({ kind: 'reveal', revealThreat: true })
    steps.push({ kind: 'vote', revealThreat: false })
  }
  return steps
}

/** Суммарное число вскрытий (накопительно) после каждого шага — для наглядной таблицы. */
export function cumulativeReveals(steps: RoundStep[]): number[] {
  let acc = 0
  return steps.map((s) => {
    if (s.kind === 'reveal') acc += 1
    return acc
  })
}

/** Сколько игроков останется после каждого шага (каждое голосование = -1). */
export function remainingPlayers(steps: RoundStep[], playerCount: number): number[] {
  let left = playerCount
  return steps.map((s) => {
    if (s.kind === 'vote') left = Math.max(0, left - 1)
    return left
  })
}

// ─── Бункер: катастрофы, угрозы, условия (III.5) ───────────────────

/** Стартовое состояние бункера, видное всем. */
export interface BunkerState {
  /** Катастрофа (показывается сразу). */
  catastrophe: string
  /** Сколько лет нужно провести в бункере (1–15, рандом на старте). */
  years: number
  /** Раскрытые по ходу игры угрозы (в порядке появления). */
  threats: string[]
}

// ─── Карты действия ───────────────────────────────────

/** На каком этапе можно сыграть карту. */
export type CardStage = 'reveal' | 'vote' | 'any'

/** Категория цели выбора (для UI модалки). */
export type CardPickKind = 'player' | 'characteristic' | 'threat' | 'catCategory'

/** Описание одного требуемого выбора при активации карты. */
export interface CardPickSpec {
  kind: CardPickKind
  /** Подсказка для UI, что выбирать. */
  label: string
}

/** Карта действия игрока. */
export interface ActionCard {
  /** Уникальный id экземпляра у игрока (не каталожный). */
  instanceId: string
  /** Каталожный id карты. */
  cardId: string
  category: string
  title: string
  code: string
  action: string
  target: string
  scope: string
  /** Сколько выборов нужно сделать при активации. */
  picks: number
  stage: CardStage
  /** Спецификация каждого выбора (для UI). */
  pickSpecs: CardPickSpec[]
  note: string
  used: boolean
}

/** Каталожная карта для админ-панели. */
export interface CatalogCard {
  cardId: string
  category: string
  title: string
  code: string
  stage: CardStage
  picks: number
}

/** Цели, выбранные игроком при активации карты. */
export interface CardTargets {
  /** Выбранные игроки (playerId). */
  players?: string[]
  /** Выбранные характеристики: {playerId, category}. */
  characteristics?: { playerId: string; category: string }[]
  /** Выбранные категории характеристик. */
  categories?: string[]
  /** Выбранные угрозы (индексы). */
  threats?: number[]
}

/** Событие о сыгранной карте (попап у всех). */
export interface CardPlayedPayload {
  byPlayerId: string
  byName: string
  title: string
  /** Человекочитаемое описание применения (с целями). */
  effectText: string
}

// ─── Стадии игры ────────────────────────────────────────────────────────────

export type GameStage =
  | 'lobby' // ожидание игроков
  | 'review' // ознакомление со своими характеристиками перед раундами
  | 'reveal' // раунд вскрытия характеристик (по ходам)
  | 'vote1' // первый круг голосования
  | 'vote2' // второй круг (переголосование при ничьей)
  | 'end' // игра окончена

/** Человекочитаемые названия стадий для UI. */
export const STAGE_LABELS: Record<GameStage, string> = {
  lobby: 'Ожидание игроков',
  review: 'Ознакомление с характеристиками',
  reveal: 'Вскрытие характеристик',
  vote1: 'Голосование',
  vote2: 'Переголосование',
  end: 'Игра окончена',
}

// ─── Полезные нагрузки событий ──────────────────────────────────────────────

/** Состояние текущего хода (кто ходит и сколько вскрытий осталось в раунде). */
export interface TurnState {
  /** id игрока, чей сейчас ход (null — ход никого не активен, напр. одновременное голосование). */
  currentPlayerId: string | null
  /** Номер текущего раунда вскрытия (с 1). */
  round: number
  /** Сколько характеристик игрок должен вскрыть за этот ход. */
  revealsThisTurn: number
  /** Сколько уже вскрыл в текущем ходу. */
  revealedThisTurn: number
  /** Поочерёдное голосование: чей сейчас голос (null — не активно). */
  currentVoterId: string | null
}

export interface GameStartedPayload {
  players: PublicPlayer[]
  stage: GameStage
  settings: LobbySettings
  turn: TurnState
  bunker: BunkerState
  /** Собственные карты действия игрока (заглушка). */
  actionCards: ActionCard[]
}

export interface BunkerUpdatedPayload {
  bunker: BunkerState
}

export interface StageChangedPayload {
  stage: GameStage
  timer: number
  isPaused: boolean
  turn: TurnState
}

export interface TurnChangedPayload {
  turn: TurnState
  timer: number
  isPaused: boolean
}

export interface TimerPayload {
  timer: number
  isPaused: boolean
}

export interface VotesUpdatedPayload {
  /** targetId -> количество голосов */
  tally: Record<string, number>
  /** id живых игроков, которые уже проголосовали */
  voted: string[]
  /** targetId -> список voterId, отдавших голос за этого игрока (II.4). */
  votesByTarget: Record<string, string[]>
}

export interface VoteResultPayload {
  eliminatedId: string | null
  /** true — ничья, объявлен второй тур */
  tie: boolean
  tiedIds: string[]
  tally: Record<string, number>
}

export interface GameEndedPayload {
  survivorIds: string[]
  players: PublicPlayer[]
}

export interface YourCharacteristicsPayload {
  characteristics: Characteristic[]
  biology: Biology
}

export interface RevealPayload {
  characteristicType: CharacteristicCategory | typeof BIOLOGY_CATEGORY
}

export interface VotePayload {
  targetId: string
}

export interface HostTimerPayload {
  timerValue?: number
}

export interface SettingsPayload {
  settings: LobbySettings
}

// ─── Типизированный контракт socket.io ──────────────────────────────────────

/** События, которые сервер отправляет клиентам. */
export interface ServerToClientEvents {
  /** Приветствие после успешного подключения: назначаем стабильный playerId. */
  welcome: (payload: { playerId: string; isHost: boolean; settings: LobbySettings }) => void
  updatePlayers: (
    players: { id: string; name: string; isAlive: boolean; connected: boolean }[],
  ) => void
  settingsUpdated: (payload: SettingsPayload) => void
  gameStarted: (payload: GameStartedPayload) => void
  /** Сброс к лобби для новой игры (П.8). */
  newGameStarted: (payload: Record<string, never>) => void
  bunkerUpdated: (payload: BunkerUpdatedPayload) => void
  /** Приватно: собственные карты игрока. */
  yourCards: (payload: { cards: ActionCard[] }) => void
  /** Карта сыграна — попап у всех. */
  cardPlayed: (payload: CardPlayedPayload) => void
  /** Каталог карт (админ-панель). */
  cardCatalog: (payload: { cards: CatalogCard[] }) => void
  yourCharacteristics: (payload: YourCharacteristicsPayload) => void
  charactersUpdated: (payload: { players: PublicPlayer[] }) => void
  stageChanged: (payload: StageChangedPayload) => void
  turnChanged: (payload: TurnChangedPayload) => void
  timerTick: (payload: TimerPayload) => void
  timerPaused: (payload: TimerPayload) => void
  timerResumed: (payload: TimerPayload) => void
  votesUpdated: (payload: VotesUpdatedPayload) => void
  voteResult: (payload: VoteResultPayload) => void
  gameEnded: (payload: GameEndedPayload) => void
  errorMessage: (payload: { message: string }) => void
}

/** События, которые клиент отправляет серверу. */
export interface ClientToServerEvents {
  updateSettings: (payload: SettingsPayload) => void
  startGame: () => void
  /** Сыграть карту действия с выбранными целями. */
  playCard: (payload: { instanceId: string; targets: CardTargets }) => void
  /** Админ-тест: выдать себе конкретную карту по cardId. */
  adminGiveCard: (payload: { cardId: string }) => void
  /** Админ: запросить каталог карт. */
  requestCatalog: () => void
  /** Хост: начать раунды вскрытия (после стадии ознакомления). */
  beginRounds: () => void
  /** Хост: начать новую игру — всех в лобби, тасуем порядок (хост тот же). */
  newGame: () => void
  revealCharacteristic: (payload: RevealPayload) => void
  endTurn: () => void
  vote: (payload: VotePayload) => void
  resolveVote: () => void
  pauseGame: () => void
  resumeGame: () => void
  resetTimer: (payload: HostTimerPayload) => void
}

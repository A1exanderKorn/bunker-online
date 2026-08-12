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
   * Сколько характеристик вскрывает каждый игрок в первом раунде
   * (до первого голосования). Классически — 1 (профессия).
   */
  revealsBeforeFirstVote: number
  /** Сколько характеристик вскрывается в каждом последующем раунде. */
  revealsPerRound: number
  /**
   * Сколько игроков остаётся в конце (проходят в бункер).
   * Классически — половина от начального состава.
   * 0 => вычисляется автоматически как половина.
   */
  survivorsCount: number
}

export const DEFAULT_SETTINGS: LobbySettings = {
  turnSeconds: 60,
  voteSeconds: 60,
  targetCoef: 0.5,
  revealsBeforeFirstVote: 1,
  revealsPerRound: 1,
  survivorsCount: 0,
}

/** Ограничения для валидации настроек на сервере. */
export const SETTINGS_LIMITS = {
  turnSeconds: { min: 10, max: 600 },
  voteSeconds: { min: 10, max: 600 },
  targetCoef: { min: 0, max: 1.5 },
  revealsBeforeFirstVote: { min: 1, max: 6 },
  revealsPerRound: { min: 1, max: 6 },
  survivorsCount: { min: 0, max: 16 },
} as const

// ─── Стадии игры ────────────────────────────────────────────────────────────

export type GameStage =
  | 'lobby' // ожидание игроков
  | 'reveal' // раунд вскрытия характеристик (по ходам)
  | 'vote1' // первый круг голосования
  | 'vote2' // второй круг (переголосование при ничьей)
  | 'end' // игра окончена

/** Человекочитаемые названия стадий для UI. */
export const STAGE_LABELS: Record<GameStage, string> = {
  lobby: 'Ожидание игроков',
  reveal: 'Вскрытие характеристик',
  vote1: 'Голосование',
  vote2: 'Переголосование',
  end: 'Игра окончена',
}

// ─── Полезные нагрузки событий ──────────────────────────────────────────────

/** Состояние текущего хода (кто ходит и сколько вскрытий осталось в раунде). */
export interface TurnState {
  /** id игрока, чей сейчас ход (null — ход никого не активен, напр. голосование). */
  currentPlayerId: string | null
  /** Номер текущего раунда вскрытия (с 1). */
  round: number
  /** Сколько характеристик игрок должен вскрыть за этот ход. */
  revealsThisTurn: number
  /** Сколько уже вскрыл в текущем ходу. */
  revealedThisTurn: number
}

export interface GameStartedPayload {
  players: PublicPlayer[]
  stage: GameStage
  settings: LobbySettings
  turn: TurnState
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
  revealCharacteristic: (payload: RevealPayload) => void
  endTurn: () => void
  vote: (payload: VotePayload) => void
  resolveVote: () => void
  pauseGame: () => void
  resumeGame: () => void
  resetTimer: (payload: HostTimerPayload) => void
}

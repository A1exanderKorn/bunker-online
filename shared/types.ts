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
}

/**
 * Публичное представление игрока для остальных участников.
 * Содержит только вскрытые характеристики.
 */
export interface PublicPlayer {
  id: string
  name: string
  isAlive: boolean
  characteristics: Characteristic[]
  biology: Biology | null
}

// ─── Стадии игры ────────────────────────────────────────────────────────────

export type GameStage =
  | 'lobby' // ожидание игроков
  | 'review' // ознакомление со своими характеристиками
  | 'reveal' // вскрытие характеристик
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

export interface GameStartedPayload {
  players: PublicPlayer[]
  stage: GameStage
}

export interface StageChangedPayload {
  stage: GameStage
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

// ─── Типизированный контракт socket.io ──────────────────────────────────────

/** События, которые сервер отправляет клиентам. */
export interface ServerToClientEvents {
  updatePlayers: (players: { id: string; name: string; isAlive: boolean }[]) => void
  gameStarted: (payload: GameStartedPayload) => void
  yourCharacteristics: (payload: YourCharacteristicsPayload) => void
  charactersUpdated: (payload: { players: PublicPlayer[] }) => void
  stageChanged: (payload: StageChangedPayload) => void
  timerTick: (payload: TimerPayload) => void
  timerPaused: (payload: TimerPayload) => void
  timerResumed: (payload: TimerPayload) => void
  votesUpdated: (payload: VotesUpdatedPayload) => void
  voteResult: (payload: VoteResultPayload) => void
  errorMessage: (payload: { message: string }) => void
}

/** События, которые клиент отправляет серверу. */
export interface ClientToServerEvents {
  startGame: () => void
  revealCharacteristic: (payload: RevealPayload) => void
  vote: (payload: VotePayload) => void
  resolveVote: () => void
  pauseGame: () => void
  resumeGame: () => void
  resetTimer: (payload: HostTimerPayload) => void
  nextStage: (payload: HostTimerPayload) => void
}

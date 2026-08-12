import path from 'path'
import type { CharacteristicCategory } from '../shared/types'

/** Порт HTTP/socket-сервера. */
export const PORT = Number(process.env.PORT) || 3000

/** Путь к файлу с характеристиками. */
export const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'data.xlsx')

/** Минимум игроков для старта игры. */
export const MIN_PLAYERS = 2

/** Максимум игроков в лобби. */
export const MAX_PLAYERS = 16

/** Сколько секунд хранить отключившегося игрока перед удалением (для реконнекта). */
export const RECONNECT_GRACE_MS = 60_000

/** Порядок раздачи категорий характеристик. */
export const CATEGORY_ORDER: CharacteristicCategory[] = [
  'Профессия',
  'Здоровье',
  'Хобби',
  'Фобия',
  'Багаж',
  'Факт',
]

/**
 * Порядок вскрытия характеристик по раундам (какую категорию открывать).
 * По классическим правилам «Бункера» первым идёт профессия, затем остальное.
 * Если раундов больше, чем категорий, лишние берутся по кругу.
 */
export const REVEAL_ORDER: CharacteristicCategory[] = [
  'Профессия',
  'Здоровье',
  'Хобби',
  'Фобия',
  'Багаж',
  'Факт',
]

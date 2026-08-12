import path from 'path'
import type { CharacteristicCategory } from '../shared/types'

/** Порт HTTP/socket-сервера. */
export const PORT = Number(process.env.PORT) || 3000

/** Путь к файлу с характеристиками. */
export const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'data.xlsx')

/** Таймер по умолчанию (секунды) для стадии/хода. */
export const DEFAULT_TIMER = 30

/** Максимально допустимое значение таймера, которое может выставить хост. */
export const MAX_TIMER = 600

/** Минимум игроков для старта игры. */
export const MIN_PLAYERS = 2

/** Максимум игроков в лобби. */
export const MAX_PLAYERS = 16

/** Порядок раздачи категорий характеристик. */
export const CATEGORY_ORDER: CharacteristicCategory[] = [
  'Профессия',
  'Здоровье',
  'Хобби',
  'Фобия',
  'Багаж',
  'Факт',
]

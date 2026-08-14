import fs from 'fs'
import path from 'path'
import type { CharacteristicCategory } from '../shared/types'

/** Порт HTTP/socket-сервера. */
export const PORT = Number(process.env.PORT) || 3000

function resolveDataPath(): string {
  if (process.env.DATA_PATH) return process.env.DATA_PATH
  const candidates = [
    path.join(__dirname, 'data.xlsx'),
    path.join(__dirname, '..', 'data.xlsx'),
    path.join(process.cwd(), 'server', 'data.xlsx'),
    path.join(process.cwd(), 'data.xlsx'),
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

/** Путь к файлу с характеристиками, картами и угрозами. */
export const DATA_PATH = resolveDataPath()

/** Минимум игроков для старта игры. */
export const MIN_PLAYERS = 2

/** Максимум игроков в лобби. */
export const MAX_PLAYERS = 16

/** Сколько секунд хранить отключившегося игрока перед удалением (для реконнекта). */
export const RECONNECT_GRACE_MS = 60_000

/** I.4: доп. время (сек) после авто-вскрытия по истечении таймера хода. */
export const TURN_GRACE_SECONDS = 15

/** Фолбэк порядка раздачи, если Excel не прочитался. */
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

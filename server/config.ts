import fs from 'fs'
import path from 'path'
import type { CharacteristicCategory } from '../shared/types'

/** Порт HTTP/socket-сервера. */
export const PORT = Number(process.env.PORT) || 3000

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR
  const candidates = [
    path.join(__dirname, 'data'),
    path.join(__dirname, '..', 'data'),
    path.join(process.cwd(), 'server', 'data'),
    path.join(process.cwd(), 'data'),
  ]
  return candidates.find((p) => fs.existsSync(path.join(p, 'characteristics', 'index.json'))) ?? candidates[0]
}

/** Каталог с JSON колоды (характеристики, бункер, карты действия). */
export const DATA_DIR = resolveDataDir()

/** Минимум игроков для старта игры. */
export const MIN_PLAYERS = 2

/** Максимум игроков в лобби. */
export const MAX_PLAYERS = 16

/** Сколько секунд хранить отключившегося игрока перед удалением (для реконнекта). */
export const RECONNECT_GRACE_MS = 180_000

/** Короткое окно для F5 в лобби, чтобы закрытая вкладка не блокировала его надолго. */
export const LOBBY_RECONNECT_GRACE_MS = 30_000

/** I.4: доп. время (сек) после авто-вскрытия по истечении таймера хода. */
export const TURN_GRACE_SECONDS = 15

/** Фолбэк порядка раздачи, если JSON не прочитался. */
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

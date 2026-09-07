import { CHARACTERISTIC_CATEGORIES } from '../shared/types'
import { readJson } from './loadJson'

export interface CharacteristicDef {
  category: string
  name: string
  coef: number
  hint: string
  tags: string[]
}

interface CharacteristicIndex {
  slots: { category: string; file: string | null; weight?: number }[]
}

interface CharacteristicFile {
  category: string
  items: { name: string; coef: number; hint: string; tags: string[] }[]
}

export function parseSurvivalTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean)
  return String(value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
}

let cache: CharacteristicDef[] | null = null
let slotsCache: CharacteristicIndex['slots'] | null = null

function loadIndex(): CharacteristicIndex['slots'] {
  if (slotsCache) return slotsCache
  slotsCache = readJson<CharacteristicIndex>('characteristics/index.json').slots
  return slotsCache
}

/**
 * Загружает характеристики из JSON один раз и кэширует результат в памяти.
 * Повторные вызовы возвращают кэш.
 */
export function loadCharacteristics(): CharacteristicDef[] {
  if (cache) return cache
  const items: CharacteristicDef[] = []
  for (const slot of loadIndex()) {
    if (!slot.file) continue
    const file = readJson<CharacteristicFile>(`characteristics/${slot.file}`)
    const category = file.category || slot.category
    for (const item of file.items) {
      if (!String(item.name ?? '').trim()) continue
      items.push({
        category,
        name: String(item.name).trim(),
        coef: Number(item.coef) || 0,
        hint: String(item.hint ?? ''),
        tags: parseSurvivalTags(item.tags),
      })
    }
  }
  cache = items
  return cache
}

/** Насколько категория участвует в балансе общего коэффициента игрока. Берётся из index.json. */
export function characteristicWeight(category: string): number {
  const weight = loadIndex().find((slot) => slot.category === category)?.weight
  return typeof weight === 'number' && Number.isFinite(weight) ? weight : 1
}

/** Возвращает строки одной категории с непустым названием (колода). */
export function rowsByCategory(category: string): CharacteristicDef[] {
  return loadCharacteristics().filter((row) => row.category === category)
}

/** Порядок категорий/слотов из index.json. */
export function contentCategoryOrder(): string[] {
  const order = loadIndex().map((slot) => slot.category).filter(Boolean)
  return order.length > 0 ? order : [...CHARACTERISTIC_CATEGORIES]
}

/** @deprecated имя оставлено для читаемости старых комментариев */
export function excelCategoryOrder(): string[] {
  return contentCategoryOrder()
}

/**
 * Категории, которые раздаются как карты (есть колода).
 * Биология и прочие «правила без колоды» сюда не входят.
 */
export function dealCategories(): string[] {
  return loadIndex()
    .filter((slot) => slot.file)
    .map((slot) => slot.category)
    .filter((category) => rowsByCategory(category).length > 0)
}

/**
 * Порядок строк на карточке игрока из index.json.
 * Категории без колоды (кроме биологии) пропускаются, если файла нет.
 */
export function displayCategoryOrder(): string[] {
  const display = loadIndex()
    .filter((slot) => slot.category === 'Биология' || (slot.file && rowsByCategory(slot.category).length > 0))
    .map((slot) => slot.category)
  if (!display.includes('Биология')) {
    const healthIdx = display.indexOf('Здоровье')
    display.splice(healthIdx >= 0 ? healthIdx + 1 : 1, 0, 'Биология')
  }
  return display.length > 0 ? display : ['Профессия', 'Здоровье', 'Биология', 'Хобби', 'Фобия', 'Багаж', 'Факт']
}

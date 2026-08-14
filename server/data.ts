import * as XLSX from 'xlsx'
import { DATA_PATH } from './config'
import { CHARACTERISTIC_CATEGORIES } from '../shared/types'

export interface ExcelRow {
  Категория: string
  Название: string
  КФ: number
  Подсказка: string
}

let cache: ExcelRow[] | null = null

/**
 * Загружает характеристики из Excel один раз и кэширует результат в памяти.
 * Повторные вызовы возвращают кэш.
 */
export function loadCharacteristics(): ExcelRow[] {
  if (cache) return cache

  const workbook = XLSX.readFile(DATA_PATH)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  cache = XLSX.utils.sheet_to_json<ExcelRow>(sheet)
  return cache
}

function named(row: ExcelRow): boolean {
  return String(row['Название'] ?? '').trim().length > 0
}

/** Возвращает строки одной категории с непустым названием (колода). */
export function rowsByCategory(category: string): ExcelRow[] {
  return loadCharacteristics().filter((row) => row['Категория'] === category && named(row))
}

/**
 * Порядок категорий из Excel (как в таблице, без дублей).
 * «Биология» тоже попадает в список — это строка на карточке, не колода.
 */
export function excelCategoryOrder(): string[] {
  const seen: string[] = []
  for (const row of loadCharacteristics()) {
    const c = String(row['Категория'] ?? '').trim()
    if (c && !seen.includes(c)) seen.push(c)
  }
  return seen.length > 0 ? seen : [...CHARACTERISTIC_CATEGORIES]
}

/**
 * Категории, которые раздаются как карты (есть названия в колоде).
 * Биология и прочие «правила без колоды» сюда не входят.
 */
export function dealCategories(): string[] {
  return excelCategoryOrder().filter((c) => c !== 'Биология' && rowsByCategory(c).length > 0)
}

/**
 * Порядок строк на карточке игрока: Excel + Биология, если её нет в таблице.
 * Категории без колоды (кроме биологии) пропускаются — масштабируется новыми листами.
 */
export function displayCategoryOrder(): string[] {
  const order = excelCategoryOrder()
  const display = order.filter((c) => c === 'Биология' || rowsByCategory(c).length > 0)
  if (!display.includes('Биология')) {
    const healthIdx = display.indexOf('Здоровье')
    display.splice(healthIdx >= 0 ? healthIdx + 1 : 1, 0, 'Биология')
  }
  return display
}

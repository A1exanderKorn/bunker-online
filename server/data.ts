import * as XLSX from 'xlsx'
import { DATA_PATH } from './config'
import type { CharacteristicCategory } from '../shared/types'

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

/** Возвращает строки одной категории. */
export function rowsByCategory(category: CharacteristicCategory): ExcelRow[] {
  return loadCharacteristics().filter((row) => row['Категория'] === category)
}

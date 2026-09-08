import { CHARACTERISTIC_CATEGORIES, type GameMode } from '../shared/types'
import { readJson } from './loadJson'
import { DATA_DIR } from './config'
import fs from 'fs'
import path from 'path'

export type { GameMode }

export interface CharacteristicDef {
  category: string
  name: string
  coef: number
  hint: string
  tags: string[]
  staged?: boolean
  stages?: string[]
}

interface CharacteristicIndex {
  slots: { category: string; file: string | null; weight?: number }[]
}

interface CharacteristicFile {
  category: string
  items: {
    name: string
    coef: number
    hint: string
    tags: string[]
    staged?: boolean
    stages?: string[]
  }[]
}

export function parseSurvivalTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean)
  return String(value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
}

export function isNewGameMode(mode: GameMode | undefined): boolean {
  return mode === 'new'
}

function indexFile(mode: GameMode): string {
  return isNewGameMode(mode) ? 'characteristics-new/index.json' : 'characteristics/index.json'
}

function charDir(mode: GameMode): string {
  return isNewGameMode(mode) ? 'characteristics-new' : 'characteristics'
}

const cache = new Map<GameMode, CharacteristicDef[]>()
const slotsCache = new Map<GameMode, CharacteristicIndex['slots']>()

function loadIndex(mode: GameMode = 'classic'): CharacteristicIndex['slots'] {
  const key = isNewGameMode(mode) ? 'new' : 'classic'
  const hit = slotsCache.get(key)
  if (hit) return hit
  const slots = readJson<CharacteristicIndex>(indexFile(key)).slots
  slotsCache.set(key, slots)
  return slots
}

export function loadCharacteristics(mode: GameMode = 'classic'): CharacteristicDef[] {
  const key = isNewGameMode(mode) ? 'new' : 'classic'
  const hit = cache.get(key)
  if (hit) return hit
  const items: CharacteristicDef[] = []
  for (const slot of loadIndex(key)) {
    if (!slot.file) continue
    const file = readJson<CharacteristicFile>(`${charDir(key)}/${slot.file}`)
    const category = file.category || slot.category
    for (const item of file.items) {
      if (!String(item.name ?? '').trim()) continue
      items.push({
        category,
        name: String(item.name).trim(),
        coef: Number(item.coef) || 0,
        hint: String(item.hint ?? ''),
        tags: parseSurvivalTags(item.tags),
        staged: !!item.staged,
        stages: Array.isArray(item.stages) ? item.stages.map(String) : [],
      })
    }
  }
  cache.set(key, items)
  return items
}

export function characteristicWeight(category: string, mode: GameMode = 'classic'): number {
  const weight = loadIndex(mode).find((slot) => slot.category === category)?.weight
  return typeof weight === 'number' && Number.isFinite(weight) ? weight : 1
}

export function rowsByCategory(category: string, mode: GameMode = 'classic'): CharacteristicDef[] {
  return loadCharacteristics(mode).filter((row) => row.category === category)
}

export function contentCategoryOrder(mode: GameMode = 'classic'): string[] {
  const order = loadIndex(mode).map((slot) => slot.category).filter(Boolean)
  return order.length > 0 ? order : [...CHARACTERISTIC_CATEGORIES]
}

export function excelCategoryOrder(mode: GameMode = 'classic'): string[] {
  return contentCategoryOrder(mode)
}

export function dealCategories(mode: GameMode = 'classic'): string[] {
  return loadIndex(mode)
    .filter((slot) => slot.file)
    .map((slot) => slot.category)
    .filter((category) => rowsByCategory(category, mode).length > 0)
}

export function displayCategoryOrder(mode: GameMode = 'classic'): string[] {
  const display = loadIndex(mode)
    .filter((slot) => slot.category === 'Биология' || (slot.file && rowsByCategory(slot.category, mode).length > 0))
    .map((slot) => slot.category)
  if (!display.includes('Биология')) {
    const healthIdx = display.indexOf('Здоровье')
    display.splice(healthIdx >= 0 ? healthIdx + 1 : 1, 0, 'Биология')
  }
  return display.length > 0 ? display : ['Профессия', 'Здоровье', 'Биология', 'Хобби', 'Фобия', 'Багаж', 'Факт']
}

export function newModeDataReady(): boolean {
  return fs.existsSync(path.join(DATA_DIR, 'characteristics-new', 'index.json'))
}

export const DEFAULT_STAGE_LABELS = ['ранняя', 'средняя', 'терминальная'] as const

export function stageLabelsOf(row: CharacteristicDef): string[] {
  if (!row.staged) return []
  return row.stages && row.stages.length === 3 ? row.stages : [...DEFAULT_STAGE_LABELS]
}

export function roundCoef(value: number): number {
  return Number((Math.round(value / 0.05) * 0.05).toFixed(2))
}

export function clampCoef(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, roundCoef(value)))
}

export interface HealthVariant {
  row: CharacteristicDef
  coef: number
  stageIndex: number | null
  stageLabel: string
  incurable: boolean
}

export function healthVariants(row: CharacteristicDef): HealthVariant[] {
  if (row.category !== 'Здоровье' || !row.staged) {
    return [{ row, coef: roundCoef(row.coef), stageIndex: null, stageLabel: '', incurable: false }]
  }
  const labels = stageLabelsOf(row)
  const deltas = [0.05, 0, -0.15]
  return labels.map((label, stageIndex) => ({
    row,
    coef: clampCoef(row.coef + deltas[stageIndex], -1, 1),
    stageIndex,
    stageLabel: label,
    incurable: stageIndex === 2,
  }))
}

export function expandForDeal(row: CharacteristicDef): HealthVariant[] {
  if (row.category === 'Здоровье') return healthVariants(row)
  return [{ row, coef: roundCoef(row.coef), stageIndex: null, stageLabel: '', incurable: false }]
}

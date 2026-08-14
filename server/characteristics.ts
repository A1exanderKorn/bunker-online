import type { Biology, Characteristic, CharacteristicCategory, CharSlot, Player, Sex } from '../shared/types'
import { slotsFromTypes } from '../shared/types'
import { CATEGORY_ORDER } from './config'
import { dealCategories, displayCategoryOrder, rowsByCategory, type ExcelRow } from './data'

/** Фишер–Йейтс, тасует массив на месте и возвращает его же. */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

/** Генерирует биологию игрока с учётом уже выданных (уникальность андроида/гермафродита). */
export function generateBiology(existing: Biology[]): Biology {
  const hasAndroid = existing.some((b) => b.sex === 'Андроид')
  const hasHerm = existing.some((b) => b.sex === 'Гермафродит')

  const rand = Math.random() * 100
  let hint: string | undefined
  let sex: Sex

  if (rand <= 1.75 && !hasHerm) {
    sex = 'Гермафродит'
  } else if (rand <= 1.75 + 2.75 && !hasAndroid) {
    sex = 'Андроид'
  } else {
    sex = Math.random() < 0.5 ? 'М' : 'Ж'
  }

  let age = Math.floor(Math.random() * (85 - 19 + 1)) + 19
  let experience = Math.floor(Math.random() * (age - 16.5) * 2) / 2

  let coef = 0.5
  if (sex === 'Ж') {
    coef = age <= 49 ? 1.0 - 0.04 * Math.abs(33 - age) : 0.4 - 0.01 * Math.abs(50 - age)
  } else if (sex === 'М') {
    coef = age <= 59 ? 1.0 - 0.03 * Math.abs(36 - age) : 0.4 - 0.01 * Math.abs(60 - age)
  }

  let infertile = false
  if ((sex === 'Ж' && age <= 49) || (sex === 'М' && age <= 59)) {
    if (Math.random() < 0.25) {
      coef -= 0.4
      infertile = true
    }
  }

  if (sex === 'Андроид') {
    coef = 1.15
    age = Math.floor(Math.random() * 20)
    experience = age
    hint = 'Обнуляет проблемы со здоровьем и фобии'
  }

  if (sex === 'Гермафродит') {
    coef = 1.25
    age = Math.floor(Math.random() * 15) + 25
    experience = Math.floor(Math.random() * (age - 16.5) * 2) / 2
    hint = 'Выступает в роли и мужчины, и женщины'
  }

  return { sex, age, experience, coef, infertile, isVisible: false, hint }
}

function parseRow(row: ExcelRow): Characteristic {
  return {
    type: row['Категория'] as Characteristic['type'],
    value: String(row['Название'] ?? '').trim(),
    coef: Number(row['КФ']) || 0,
    hint: String(row['Подсказка'] ?? ''),
    isVisible: false,
    occ: 0,
  }
}

/** Проставляет occ (Багаж #1 / #2) по порядку в наборе. */
export function assignOccurrences(chars: Characteristic[]): void {
  const seen: Record<string, number> = {}
  for (const c of chars) {
    const occ = seen[c.type] ?? 0
    c.occ = occ
    seen[c.type] = occ + 1
  }
}

export function findChar(
  chars: Characteristic[],
  type: string,
  occ = 0,
): Characteristic | undefined {
  return chars.find((c) => c.type === type && (c.occ ?? 0) === occ)
}

/**
 * Выбирает кандидата со смещением так, чтобы средний коэффициент набора
 * стремился к целевому (targetCoef).
 */
function pickWithBias<T extends { coef: number }>(
  candidates: T[],
  currentAvg: number,
  count: number,
  targetCoef: number,
): T {
  const total = currentAvg * count
  const desiredCoef = targetCoef * (count + 1) - total

  const weights = candidates.map((c) => ({
    candidate: c,
    weight: Math.max(0, 1 - Math.abs(c.coef - desiredCoef)),
  }))

  const filtered = weights.filter((w) => w.weight > 0)
  if (filtered.length === 0) {
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  const totalWeight = filtered.reduce((sum, w) => sum + w.weight, 0)
  let rnd = Math.random() * totalWeight
  for (const { candidate, weight } of filtered) {
    if (rnd < weight) return candidate
    rnd -= weight
  }
  return filtered[0].candidate
}

/** Раздаёт одному игроку биологию и полный набор характеристик по заданной программе категорий. */
function dealToPlayer(
  usedValues: Set<string>,
  biologies: Biology[],
  targetCoef: number,
  categoryProgram: CharacteristicCategory[],
): {
  biology: Biology
  characteristics: Characteristic[]
} {
  const biology = generateBiology(biologies)
  const characteristics: Characteristic[] = []
  let currentCoef = biology.coef

  for (const category of categoryProgram) {
    const available = rowsByCategory(category)
      .map(parseRow)
      .filter((c) => !usedValues.has(c.value))
    if (available.length === 0) continue

    const chosen = pickWithBias(available, currentCoef, characteristics.length, targetCoef)
    usedValues.add(chosen.value)
    currentCoef = (currentCoef * characteristics.length + chosen.coef) / (characteristics.length + 1)
    characteristics.push(chosen)
  }

  assignOccurrences(characteristics)
  return { biology, characteristics }
}

/** Настройки раздачи, влияющие на набор категорий. */
export interface DealOptions {
  targetCoef?: number
  /** III.3: добавить второй «Багаж» (8-я характеристика). */
  extraBaggage?: boolean
  /** III.4: не раздавать «Фобию». */
  noPhobias?: boolean
}

/** Строит программу категорий с учётом багажа/фобий. */
function buildCategoryProgram(opts: DealOptions): CharacteristicCategory[] {
  let program = dealCategories()
  if (program.length === 0) program = [...CATEGORY_ORDER]
  if (opts.noPhobias) program = program.filter((c) => c !== 'Фобия')
  if (opts.extraBaggage) {
    const idx = program.lastIndexOf('Багаж')
    if (idx >= 0) program.splice(idx + 1, 0, 'Багаж')
    else program.push('Багаж')
  }
  return program
}

/** Раскладка строк карточки: Excel-порядок + второй багаж / без фобий. */
export function buildCharLayout(opts: DealOptions): CharSlot[] {
  let types = displayCategoryOrder()
  if (types.length === 0) {
    types = ['Профессия', 'Здоровье', 'Биология', 'Хобби', 'Фобия', 'Багаж', 'Факт']
  }
  if (opts.noPhobias) types = types.filter((c) => c !== 'Фобия')
  if (opts.extraBaggage) {
    const idx = types.lastIndexOf('Багаж')
    if (idx >= 0) types.splice(idx + 1, 0, 'Багаж')
    else types.push('Багаж')
  }
  return slotsFromTypes(types)
}

/** Раздаёт характеристики всем игрокам (мутирует объекты игроков). */
export function dealCharacteristics(players: Player[], opts: DealOptions = {}): void {
  const targetCoef = opts.targetCoef ?? 0.5
  const program = buildCategoryProgram(opts)
  const used = new Set<string>()
  const biologies: Biology[] = []

  for (const player of players) {
    const { biology, characteristics } = dealToPlayer(used, biologies, targetCoef, program)
    biologies.push(biology)
    player.biology = biology
    player.characteristics = characteristics
  }
}

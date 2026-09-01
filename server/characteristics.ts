import type { Biology, Characteristic, CharacteristicCategory, CharSlot, Player, Sex } from '../shared/types'
import { BIOLOGY_CATEGORY, slotsFromTypes } from '../shared/types'
import { CATEGORY_ORDER } from './config'
import { dealCategories, displayCategoryOrder, parseSurvivalTags, rowsByCategory, type ExcelRow } from './data'

/** Фишер–Йейтс, тасует массив на месте и возвращает его же. */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/** Насколько категория участвует в балансе общего коэффициента игрока. */
export function characteristicWeight(category: string): number {
  const weights: Record<string, number> = {
    Здоровье: 1,
    Профессия: 0.8,
    Биология: 1,
    Фобия: 0.75,
    Факт: 0.75,
    Багаж: 0.5,
  }
  return weights[category] ?? 1
}

/** Стаж слегка дополняет возрастной КФ: неизвестно, насколько полезна профессия. */
export function experienceModifier(age: number, experience: number): number {
  const availableYears = Math.max(0, age - 16)
  if (availableYears === 0) return -0.02
  const ratio = Math.max(0, Math.min(1, experience / availableYears))
  return 0.06 - 0.32 * (ratio - 0.5) ** 2
}

function rollExperience(age: number): number {
  const maxExperience = Math.max(0, age - 16)
  return Math.floor(Math.random() * (maxExperience * 2 + 1)) / 2
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
  let experience = rollExperience(age)

  let baseCoef = 0.5
  if (sex === 'Ж') {
    baseCoef = age <= 50
      ? 0.92 - 0.012 * Math.abs(30 - age)
      : 0.78 - 0.006 * (age - 50)
  } else if (sex === 'М') {
    baseCoef = age <= 60
      ? 0.9 - 0.008 * Math.abs(35 - age)
      : 0.8 - 0.005 * (age - 60)
  }

  let infertile = false
  if ((sex === 'Ж' && age > 50) || (sex === 'М' && age > 60)) {
    infertile = true
  } else if ((sex === 'Ж' && age <= 49) || (sex === 'М' && age <= 59)) {
    if (Math.random() < 0.25) {
      infertile = true
    }
  }

  if (sex === 'Андроид') {
    baseCoef = 0.95
    age = Math.floor(Math.random() * 20)
    experience = rollExperience(age)
    hint = 'Обнуляет проблемы со здоровьем и фобии'
  }

  if (sex === 'Гермафродит') {
    baseCoef = 0.95
    age = Math.floor(Math.random() * 15) + 25
    experience = rollExperience(age)
    hint = 'Выступает в роли и мужчины, и женщины'
  }

  // Репродуктивный штраф отдельно учитывается в финальном выживании, поэтому
  // здесь он не должен обнулять в остальном полезную биологию персонажа.
  const coef = clamp01(baseCoef + experienceModifier(age, experience) - (infertile ? 0.2 : 0))
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
    tags: parseSurvivalTags(row['Теги выживания']),
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
/**
 * Сила притяжения к целевому КФ. Чем меньше, тем больше рандома в выборе.
 * BIAS_STRENGTH регулирует, насколько резко падает вес кандидата при удалении
 * его КФ от желаемого; FLOOR_WEIGHT гарантирует, что любой кандидат сохраняет
 * ненулевой шанс (никакого жёсткого обнуления и случайного фолбэка).
 */
const BIAS_STRENGTH = 4
const FLOOR_WEIGHT = 0.15

function pickWithBias<T extends { coef: number }>(
  candidates: T[],
  weightedSum: number,
  currentTotalWeight: number,
  targetCoef: number,
  candidateWeight: number,
): T {
  // Какой КФ кандидата нужен, чтобы новое взвешенное среднее стало targetCoef.
  const desiredCoef =
    (targetCoef * (currentTotalWeight + candidateWeight) - weightedSum) / candidateWeight

  // Мягкий вес: 1/(1+k*|Δ|) плавно убывает и никогда не обнуляется, плюс пол.
  // Так смещение к целевому среднему работает, но выбор остаётся заметно случайным.
  const weights = candidates.map((c) => ({
    candidate: c,
    weight: FLOOR_WEIGHT + (1 - FLOOR_WEIGHT) / (1 + BIAS_STRENGTH * Math.abs(c.coef - desiredCoef)),
  }))

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0)
  let rnd = Math.random() * totalWeight
  for (const { candidate, weight } of weights) {
    if (rnd < weight) return candidate
    rnd -= weight
  }
  return weights[weights.length - 1].candidate
}

/** Раздаёт одному игроку биологию и полный набор характеристик по заданной программе категорий. */
function dealToPlayer(
  usedValues: Set<string>,
  biologies: Biology[],
  targetCoef: number | null,
  categoryProgram: CharacteristicCategory[],
): {
  biology: Biology
  characteristics: Characteristic[]
} {
  const biology = generateBiology(biologies)
  const characteristics: Characteristic[] = []
  let weightedSum = biology.coef * characteristicWeight(BIOLOGY_CATEGORY)
  let totalWeight = characteristicWeight(BIOLOGY_CATEGORY)

  for (const category of shuffleArray([...categoryProgram])) {
    const available = rowsByCategory(category)
      .map(parseRow)
      .filter((c) => !usedValues.has(c.value))
    if (available.length === 0) continue

    const weight = characteristicWeight(category)
    const chosen = targetCoef === null
      ? available[Math.floor(Math.random() * available.length)]
      : pickWithBias(available, weightedSum, totalWeight, targetCoef, weight)
    usedValues.add(chosen.value)
    weightedSum += chosen.coef * weight
    totalWeight += weight
    characteristics.push(chosen)
  }

  assignOccurrences(characteristics)
  return { biology, characteristics }
}

/** Настройки раздачи, влияющие на набор категорий. */
export interface DealOptions {
  /** null отключает притяжение раздачи к целевому коэффициенту. */
  targetCoef?: number | null
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
  const targetCoef = opts.targetCoef === null ? null : (opts.targetCoef ?? 0.5)
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

/** Случайные уникальные значения категории для массовой перераздачи. */
export function drawUniqueCharacteristics(
  category: string,
  count: number,
  excludedValues: Iterable<string> = [],
): Characteristic[] {
  const excluded = new Set(excludedValues)
  const unique = new Map<string, Characteristic>()
  for (const row of rowsByCategory(category)) {
    const characteristic = parseRow(row)
    if (characteristic.value && !excluded.has(characteristic.value) && !unique.has(characteristic.value)) {
      unique.set(characteristic.value, characteristic)
    }
  }
  return shuffleArray([...unique.values()]).slice(0, Math.max(0, count))
}

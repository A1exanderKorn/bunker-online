import type { Biology, Characteristic, CharacteristicCategory, CharSlot, Player, Sex } from '../shared/types'
import { BIOLOGY_CATEGORY, slotsFromTypes } from '../shared/types'
import { CATEGORY_ORDER } from './config'
import {
  dealCategories,
  displayCategoryOrder,
  rowsByCategory,
  characteristicWeight,
  type CharacteristicDef,
  type GameMode,
} from './data'

/** Фишер–Йейтс, тасует массив на месте и возвращает его же. */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

export { characteristicWeight }

/** Стаж линейно растёт от −0.02 за 1 год до +0.06 за максимально возможный стаж. */
export function experienceModifier(age: number, experience: number): number {
  const availableYears = Math.max(0, age - 16)
  if (availableYears <= 0 || experience <= 1) return -0.02
  if (availableYears <= 1) return 0.06
  const progress = Math.max(0, Math.min(1, (experience - 1) / (availableYears - 1)))
  return -0.02 + 0.08 * progress
}

function rollExperience(age: number): number {
  const maxExperience = Math.max(0, age - 16)
  return Math.floor(Math.random() * (maxExperience * 2 + 1)) / 2
}

export const MIN_BIOLOGY_AGE = 19
export const MAX_BIOLOGY_AGE = 90
const OLDEST_AGE_WEIGHT = 0.45

/** Относительный вес возраста: плавно уменьшается от 1.0 в 19 лет до 0.45 в 90. */
export function biologyAgeWeight(age: number): number {
  const clampedAge = Math.max(MIN_BIOLOGY_AGE, Math.min(MAX_BIOLOGY_AGE, age))
  const progress = (clampedAge - MIN_BIOLOGY_AGE) / (MAX_BIOLOGY_AGE - MIN_BIOLOGY_AGE)
  return 1 - (1 - OLDEST_AGE_WEIGHT) * progress
}

const BIOLOGY_AGES = Array.from(
  { length: MAX_BIOLOGY_AGE - MIN_BIOLOGY_AGE + 1 },
  (_, index) => MIN_BIOLOGY_AGE + index,
)
const TOTAL_AGE_WEIGHT = BIOLOGY_AGES.reduce((sum, age) => sum + biologyAgeWeight(age), 0)

/** Вероятность выпадения конкретного возраста в обычной биологии. */
export function biologyAgeProbability(age: number): number {
  if (!Number.isInteger(age) || age < MIN_BIOLOGY_AGE || age > MAX_BIOLOGY_AGE) return 0
  return biologyAgeWeight(age) / TOTAL_AGE_WEIGHT
}

/** Взвешенный возраст: каждый следующий год немного менее вероятен предыдущего. */
export function rollBiologyAge(randomValue = Math.random()): number {
  let cursor = Math.max(0, Math.min(1 - Number.EPSILON, randomValue)) * TOTAL_AGE_WEIGHT
  for (const age of BIOLOGY_AGES) {
    cursor -= biologyAgeWeight(age)
    if (cursor < 0) return age
  }
  return MAX_BIOLOGY_AGE
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
  } else if (rand <= 1.75 + 2.25 && !hasAndroid) {
    sex = 'Андроид'
  } else {
    sex = Math.random() < 0.5 ? 'М' : 'Ж'
  }

  const age = sex === 'Андроид'
    ? Math.floor(Math.random() * 20)
    : sex === 'Гермафродит'
      ? Math.floor(Math.random() * 15) + 25
      : rollBiologyAge()
  const experience = rollExperience(age)

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

  const guaranteedInfertility =
    ((sex === 'Ж' || sex === 'Гермафродит') && age > 50) ||
    (sex === 'М' && age > 60)
  const infertile = sex !== 'Андроид' && (guaranteedInfertility || Math.random() < 0.1)

  if (sex === 'Андроид') {
    baseCoef = 0.95
    hint = 'Обнуляет проблемы со здоровьем и фобии'
  }

  if (sex === 'Гермафродит') {
    baseCoef = 0.95
    hint = 'Выступает в роли и мужчины, и женщины'
  }

  // Репродуктивный штраф отдельно учитывается в финальном выживании, поэтому
  // здесь он не должен обнулять в остальном полезную биологию персонажа.
  const coef = clamp01(baseCoef + experienceModifier(age, experience) - (infertile ? 0.2 : 0))
  return { sex, age, experience, coef, infertile, isVisible: false, hint }
}

/** Обычный М/Ж: возраст 19–90. Без андроида и гермафродита. */
export function generateOrdinaryBiology(): Biology {
  const sex: Sex = Math.random() < 0.5 ? 'М' : 'Ж'
  const age = rollBiologyAge()
  const experience = rollExperience(age)
  const baseCoef = sex === 'Ж'
    ? (age <= 50 ? 0.92 - 0.012 * Math.abs(30 - age) : 0.78 - 0.006 * (age - 50))
    : (age <= 60 ? 0.9 - 0.008 * Math.abs(35 - age) : 0.8 - 0.005 * (age - 60))
  const guaranteedInfertility =
    (sex === 'Ж' && age > 50) || (sex === 'М' && age > 60)
  const infertile = guaranteedInfertility || Math.random() < 0.1
  const coef = clamp01(baseCoef + experienceModifier(age, experience) - (infertile ? 0.2 : 0))
  return { sex, age, experience, coef, infertile, isVisible: false }
}

function parseRow(row: CharacteristicDef, mode: GameMode = 'classic'): Characteristic {
  return {
    type: row.category,
    value: String(row.name ?? '').trim(),
    coef: Number(row.coef) || 0,
    hint: String(row.hint ?? ''),
    isVisible: false,
    occ: 0,
    tags: [...(row.tags ?? [])],
    stageLabel: undefined,
    stageIndex: undefined,
    incurable: undefined,
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
const BIAS_STRENGTH = 5
const FLOOR_WEIGHT = 0.12

/** Относительный вес кандидата по расстоянию от требуемого коэффициента. */
export function targetCandidateWeight(distance: number): number {
  return FLOOR_WEIGHT + (1 - FLOOR_WEIGHT) / (1 + BIAS_STRENGTH * Math.abs(distance))
}

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
    weight: targetCandidateWeight(c.coef - desiredCoef),
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
  mode: GameMode = 'classic',
): {
  biology: Biology
  characteristics: Characteristic[]
} {
  const biology = generateBiology(biologies)
  const characteristics: Characteristic[] = []
  let weightedSum = biology.coef * characteristicWeight(BIOLOGY_CATEGORY, mode)
  let totalWeight = characteristicWeight(BIOLOGY_CATEGORY, mode)

  for (const category of shuffleArray([...categoryProgram])) {
    const available = rowsByCategory(category, mode)
      .map((row) => parseRow(row, mode))
      .filter((c) => !usedValues.has(c.value))
    if (available.length === 0) continue

    const weight = characteristicWeight(category, mode)
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
  gameMode?: GameMode
}

/** Строит программу категорий с учётом багажа/фобий. */
function buildCategoryProgram(opts: DealOptions): CharacteristicCategory[] {
  const mode = opts.gameMode ?? 'classic'
  let program = dealCategories(mode)
  if (program.length === 0) program = [...CATEGORY_ORDER]
  if (opts.noPhobias) program = program.filter((c) => c !== 'Фобия')
  if (opts.extraBaggage) {
    const idx = program.lastIndexOf('Багаж')
    if (idx >= 0) program.splice(idx + 1, 0, 'Багаж')
    else program.push('Багаж')
  }
  return program
}

export function buildCharLayout(opts: DealOptions): CharSlot[] {
  const mode = opts.gameMode ?? 'classic'
  let types = displayCategoryOrder(mode)
  if (types.length === 0) {
    types = ['Профессия', 'Здоровье', 'Биология', 'Хобби', 'Фобия', 'Багаж', 'Факт']
  }
  if (opts.noPhobias) types = types.filter((c) => c !== 'Фобия')
  if (opts.extraBaggage) {
    const idx = types.lastIndexOf('Багаж')
    if (idx >= 0) types.splice(idx + 1, 0, 'Багаж')
    else types.push('Багаж')
  }
  return slotsFromTypes(types).map((slot) => ({
    ...slot,
    weight: characteristicWeight(slot.type, mode),
  }))
}

export function dealCharacteristics(players: Player[], opts: DealOptions = {}): void {
  const mode = opts.gameMode ?? 'classic'
  if (mode === 'new') {
    const { dealNewModeToPlayers } = require('./dealNew') as typeof import('./dealNew')
    dealNewModeToPlayers(players, opts)
    return
  }
  const targetCoef = opts.targetCoef === null ? null : (opts.targetCoef ?? 0.5)
  const program = buildCategoryProgram(opts)
  const used = new Set<string>()
  const biologies: Biology[] = []

  for (const player of players) {
    const { biology, characteristics } = dealToPlayer(used, biologies, targetCoef, program, mode)
    biologies.push(biology)
    player.biology = biology
    player.characteristics = characteristics
  }
}

export function drawUniqueCharacteristics(
  category: string,
  count: number,
  excludedValues: Iterable<string> = [],
  mode: GameMode = 'classic',
): Characteristic[] {
  const excluded = new Set(excludedValues)
  const unique = new Map<string, Characteristic>()
  for (const row of rowsByCategory(category, mode)) {
    const characteristic = parseRow(row, mode)
    if (characteristic.value && !excluded.has(characteristic.value) && !unique.has(characteristic.value)) {
      unique.set(characteristic.value, characteristic)
    }
  }
  return shuffleArray([...unique.values()]).slice(0, Math.max(0, count))
}

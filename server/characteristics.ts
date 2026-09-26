import type { Biology, Characteristic, CharacteristicCategory, CharSlot, Player } from '../shared/types'
import { BIOLOGY_CATEGORY, slotsFromTypes } from '../shared/types'
import { CATEGORY_ORDER } from './config'
import {
  dealCategories,
  displayCategoryOrder,
  rowsByCategory,
  characteristicWeight,
  expandForDeal,
  type HealthVariant,
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

export { characteristicWeight }
export { experienceModifier, biologyAgeWeight, biologyAgeProbability, rollBiologyAge, MIN_BIOLOGY_AGE, MAX_BIOLOGY_AGE, generateBiology, generateOrdinaryBiology } from './biology'
import { generateBiology } from './biology'

function parseVariant(variant: HealthVariant): Characteristic {
  const row = variant.row
  return {
    type: row.category,
    value: String(row.name ?? '').trim(),
    coef: variant.coef,
    hint: variant.hint,
    stageLabel: variant.stageLabel,
    stageIndex: variant.stageIndex,
    incurable: variant.incurable,
    isVisible: false,
    occ: 0,
    tags: [...(row.tags ?? [])],
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
  const biology = generateBiology(biologies, targetCoef)
  const characteristics: Characteristic[] = []
  let weightedSum = biology.coef * characteristicWeight(BIOLOGY_CATEGORY, mode)
  let totalWeight = characteristicWeight(BIOLOGY_CATEGORY, mode)

  for (const category of shuffleArray([...categoryProgram])) {
    const available = rowsByCategory(category, mode)
      .flatMap(expandForDeal)
      .map(parseVariant)
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
    const variants = expandForDeal(row)
    const characteristic = parseVariant(variants[Math.floor(Math.random() * variants.length)])
    if (characteristic.value && !excluded.has(characteristic.value) && !unique.has(characteristic.value)) {
      unique.set(characteristic.value, characteristic)
    }
  }
  return shuffleArray([...unique.values()]).slice(0, Math.max(0, count))
}

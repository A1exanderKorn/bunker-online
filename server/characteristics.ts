import type { Biology, Characteristic, Player, Sex } from '../shared/types'
import { CATEGORY_ORDER } from './config'
import { rowsByCategory, type ExcelRow } from './data'

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
    value: row['Название'],
    coef: row['КФ'],
    hint: row['Подсказка'],
    isVisible: false,
  }
}

/**
 * Выбирает кандидата со смещением так, чтобы средний коэффициент набора
 * стремился к целевому (0.5).
 */
function pickWithBias<T extends { coef: number }>(candidates: T[], currentAvg: number, count: number): T {
  const targetCoef = 0.5
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

/** Раздаёт одному игроку биологию и полный набор характеристик. */
function dealToPlayer(usedValues: Set<string>, biologies: Biology[]): {
  biology: Biology
  characteristics: Characteristic[]
} {
  const biology = generateBiology(biologies)
  const characteristics: Characteristic[] = []
  let currentCoef = biology.coef

  for (const category of CATEGORY_ORDER) {
    const available = rowsByCategory(category)
      .map(parseRow)
      .filter((c) => !usedValues.has(c.value))

    const chosen = pickWithBias(available, currentCoef, characteristics.length)
    usedValues.add(chosen.value)
    currentCoef = (currentCoef * characteristics.length + chosen.coef) / (characteristics.length + 1)
    characteristics.push(chosen)
  }

  return { biology, characteristics }
}

/** Раздаёт характеристики всем игрокам (мутирует объекты игроков). */
export function dealCharacteristics(players: Player[]): void {
  const used = new Set<string>()
  const biologies: Biology[] = []

  for (const player of players) {
    const { biology, characteristics } = dealToPlayer(used, biologies)
    biologies.push(biology)
    player.biology = biology
    player.characteristics = characteristics
  }
}

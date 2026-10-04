import type { Biology, Characteristic } from '../shared/types'
import { biologyCoefficient, isBiologyInfertile } from './biology'
import { expandForDeal, rowsByCategory } from './data'

/** Те же теги биологии, которые используются в финальном подсчёте. */
export function biologyTags(bio: Biology | null): string[] {
  if (!bio) return []
  const tags: string[] = []
  if (bio.sex === 'М' || bio.sex === 'Гермафродит') tags.push('male')
  if (bio.sex === 'Ж' || bio.sex === 'Гермафродит') tags.push('female')
  if (bio.sex === 'Андроид') tags.push('engineering', 'bunker_assistance_big')
  if (isBiologyInfertile(bio)) tags.push('reproductive_edge')
  return tags
}

export function improvedOrWorseCharacteristic(current: Characteristic, improve: boolean, excluded: Set<string>): Characteristic | null {
  const candidates = rowsByCategory(current.type).flatMap(expandForDeal).filter(v =>
    (improve ? v.coef > current.coef : v.coef < current.coef) &&
    (v.row.name === current.value || !excluded.has(v.row.name)),
  )
  if (!candidates.length) return null
  const v = candidates[Math.floor(Math.random() * candidates.length)]
  return { ...current, value: v.row.name, coef: v.coef, tags: [...v.row.tags], hint: v.hint,
    stageLabel: v.stageLabel, stageIndex: v.stageIndex, incurable: v.incurable }
}

/** Перебор допустимых обычных биологий: поиск не сдаётся после случайных неудачных попыток. */
export function improvedOrWorseBiology(current: Biology, improve: boolean): Biology | null {
  const pool: Biology[] = []
  for (const sex of ['М', 'Ж'] as const) for (let age = 19; age <= 90; age++) {
    for (const infertile of [false, true]) {
      if (!infertile && age > (sex === 'М' ? 60 : 50)) continue
      for (let experience = 0; experience <= age - 16; experience += 0.5) {
        const bio: Biology = { sex, age, experience, infertile, coef: 0, isVisible: current.isVisible }
        bio.coef = biologyCoefficient(bio)
        if (improve ? bio.coef > current.coef : bio.coef < current.coef) pool.push(bio)
      }
    }
  }
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
}

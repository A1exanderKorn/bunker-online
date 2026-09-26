import type { Biology, Sex } from '../shared/types'

export const MIN_BIOLOGY_AGE = 19
export const MAX_BIOLOGY_AGE = 90
const ages = Array.from({ length: 72 }, (_, i) => i + MIN_BIOLOGY_AGE)
const clamp = (n: number) => Math.max(-1, Math.min(1, n))

export function experienceModifier(age: number, experience: number): number {
  const progress = Math.max(0, Math.min(1, (experience - 1) / Math.max(1, age - 17)))
  return -0.01 + 0.02 * progress
}

/** Игровая оценка, не медицинская модель: пик в 35 лет, стаж второстепенен. */
export function biologyCoefficient(bio: Pick<Biology, 'sex' | 'age' | 'experience' | 'infertile'>): number {
  if (bio.sex === 'Андроид') return 1
  const age = Math.max(MIN_BIOLOGY_AGE, Math.min(MAX_BIOLOGY_AGE, bio.age))
  const ageCoef = age <= 35 ? 0.2 + (age - 19) * 0.05
    : age <= 55 ? 1 - (age - 35) * 0.045
      : 0.1 - (age - 55) * 0.032
  if (bio.sex === 'транс' || bio.sex === 'оно/мы') {
    // Условная игровая шкала этих карт: возраст/стаж, без дополнительных штрафов.
    return Number(((clamp(ageCoef + experienceModifier(age, bio.experience)) - 1) / 2).toFixed(2))
  }
  return Number(clamp(ageCoef + experienceModifier(age, bio.experience) - (bio.infertile ? 0.3 : 0)).toFixed(2))
}

export function biologyAgeWeight(age: number): number {
  return 1 - 0.55 * (Math.max(19, Math.min(90, age)) - 19) / 71
}
const totalWeight = ages.reduce((sum, age) => sum + biologyAgeWeight(age), 0)
export function biologyAgeProbability(age: number): number {
  return Number.isInteger(age) && age >= 19 && age <= 90 ? biologyAgeWeight(age) / totalWeight : 0
}
export function rollBiologyAge(randomValue = Math.random()): number {
  let cursor = Math.max(0, Math.min(1 - Number.EPSILON, randomValue)) * totalWeight
  for (const age of ages) {
    cursor -= biologyAgeWeight(age)
    if (cursor < 0) return age
  }
  return 90
}

function organicBiology(sexes: Sex[], target: number | null, random: () => number): Biology {
  // Each candidate keeps its own computed coefficient; targeting never overwrites it.
  const candidates: { bio: Biology; weight: number }[] = []
  for (const sex of sexes) for (const age of ages) {
    const guaranteed = age > (sex === 'М' ? 60 : 50)
    const experience = Math.floor(random() * ((age - 16) * 2 + 1)) / 2
    for (const infertile of [false, true]) {
      if (guaranteed && !infertile) continue
      const bio: Biology = { sex, age, experience, infertile, coef: 0, isVisible: false }
      bio.coef = biologyCoefficient(bio)
      const distance = target == null ? 0 : Math.abs(bio.coef - clamp(target))
      const weight = biologyAgeWeight(age) * (guaranteed ? 1 : infertile ? 0.1 : 0.9)
        * (target == null ? 1 : distance <= 0.3 + 1e-9 ? Math.exp(-0.5 * (distance / 0.15) ** 2) : 0)
      candidates.push({ bio, weight })
    }
  }
  let cursor = random() * candidates.reduce((sum, c) => sum + c.weight, 0)
  for (const candidate of candidates) {
    if (candidate.weight <= 0) continue
    cursor -= candidate.weight
    if (cursor < 0) return candidate.bio
  }
  return candidates.filter(c => c.weight > 0).slice(-1)[0].bio
}

export function generateOrdinaryBiology(target: number | null = null, random: () => number = Math.random): Biology {
  return organicBiology(['М', 'Ж'], target, random)
}

/** One roll per player, outside deal retries; at most one of each rare type per lobby. */
export function generateRareBiology(existing: Biology[], random: () => number = Math.random, target: number | null = null): Biology | null {
  const roll = random()
  if (roll < 0.01 && !existing.some(b => b.sex === 'Гермафродит')) {
    return { ...organicBiology(['Гермафродит'], target, random), hint: 'Два в одном.' }
  }
  if (roll >= 0.01 && roll < 0.025 && !existing.some(b => b.sex === 'Андроид')) {
    const age = 18 + Math.floor(random() * 20)
    return { sex: 'Андроид', age, experience: Math.floor(random() * (age - 15)), infertile: false,
      coef: 1, isVisible: false, hint: 'Не забудьте зарядное устройство.' }
  }
  const sex = roll >= 0.025 && roll < 0.035 ? 'транс'
    : roll >= 0.035 && roll < 0.045 ? 'оно/мы' : null
  if (sex && !existing.some(b => b.sex === sex)) {
    // Не связываем идентичность с бесплодием: здесь это только отдельная игровая карта.
    const age = rollBiologyAge(random())
    const experience = Math.floor(random() * ((age - 16) * 2 + 1)) / 2
    const bio: Biology = { sex, age, experience, infertile: false, coef: 0, isVisible: false }
    bio.coef = biologyCoefficient(bio)
    return bio
  }
  return null
}

export function generateBiology(existing: Biology[], target: number | null = null): Biology {
  return generateRareBiology(existing, Math.random, target) ?? generateOrdinaryBiology(target)
}

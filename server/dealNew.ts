import type { Biology, Characteristic, CharacteristicCategory, Player } from '../shared/types'
import { BIOLOGY_CATEGORY } from '../shared/types'
import {
  characteristicWeight,
  clampCoef,
  expandForDeal,
  rowsByCategory,
  type GameMode,
  type HealthVariant,
} from './data'
import {
  assignOccurrences,
  generateOrdinaryBiology,
  shuffleArray,
  type DealOptions,
} from './characteristics'

import { generateRareBiology } from './biology'
export { generateRareBiology } from './biology'

const MAX_ATTEMPTS = 8000

export function slotMinMax(category: string): { min: number; max: number } {
  if (category === 'Багаж') return { min: -1, max: 1.15 }
  return { min: -1, max: 1 }
}

function remainingBounds(slots: string[], fromIndex: number): { minW: number; maxW: number } {
  let minW = 0
  let maxW = 0
  for (let i = fromIndex; i < slots.length; i += 1) {
    const cat = slots[i]
    const w = characteristicWeight(cat, 'new')
    const range = slotMinMax(cat)
    minW += w * range.min
    maxW += w * range.max
  }
  return { minW, maxW }
}

function pickSector(weights: number[], random: () => number): number {
  const total = weights.reduce((s, w) => s + w, 0)
  let rnd = random() * total
  for (let i = 0; i < weights.length; i += 1) {
    if (rnd < weights[i]) return i
    rnd -= weights[i]
  }
  return weights.length - 1
}

function sampleUniform(min: number, max: number, random: () => number): number {
  if (max <= min) return min
  return min + random() * (max - min)
}

/** 10 секторов: фланги 4/9+4/9, центр 1/9 с плотностью |x−μ|. */
export function sampleWShape(min: number, max: number, random: () => number = Math.random): number {
  if (max <= min) return min
  const width = max - min
  const step = width / 10
  const mid = (min + max) / 2
  const sectorWeights = [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 18, 1 / 18, 1 / 9, 1 / 9, 1 / 9, 1 / 9]
  const i = pickSector(sectorWeights, random)
  const a = min + i * step
  const b = a + step
  if (i === 4 || i === 5) {
    const left = Math.max(a, min)
    const right = Math.min(b, max)
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = sampleUniform(left, right, random)
      const peak = Math.max(Math.abs(left - mid), Math.abs(right - mid), 1e-9)
      if (random() <= Math.abs(x - mid) / peak) return x
    }
    return sampleUniform(left, right, random)
  }
  return sampleUniform(a, b, random)
}

export function sampleTruncatedNormal(min: number, max: number, random: () => number = Math.random): number {
  if (max <= min) return min
  const mu = (min + max) / 2
  const d = (max - min) / 2
  const sigma = d / Math.sqrt(2 * Math.log(4))
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const u1 = Math.max(1e-12, random())
    const u2 = random()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    const x = mu + sigma * z
    if (x >= min && x <= max) return x
  }
  return mu
}

function variantToChar(variant: HealthVariant, category: string): Characteristic {
  return {
    type: category,
    value: variant.row.name,
    coef: variant.coef,
    hint: variant.hint,
    stageLabel: variant.stageLabel,
    stageIndex: variant.stageIndex,
    incurable: variant.incurable,
    isVisible: false,
    occ: 0,
    tags: [...variant.row.tags],
  }
}

function pickVariant(
  category: string,
  target: number,
  used: Set<string>,
  mode: GameMode,
): HealthVariant | null {
  const pool = rowsByCategory(category, mode)
    .flatMap(expandForDeal)
    .filter((variant) => !used.has(variant.row.name))
  if (pool.length === 0) return null
  const exact = pool.filter((variant) => Math.abs(variant.coef - target) < 0.001)
  const candidates = exact.length > 0 ? exact : pool
  let best = candidates[0]
  let bestDist = Math.abs(best.coef - target)
  for (const variant of candidates) {
    const dist = Math.abs(variant.coef - target)
    if (dist < bestDist) {
      best = variant
      bestDist = dist
    }
  }
  const close = candidates.filter((variant) => Math.abs(variant.coef - target) === bestDist)
  return close[Math.floor(Math.random() * close.length)]
}

function highPerkThreshold(targetCoeff: number): { need: number; bar: number } {
  if (targetCoeff < -0.50) return { need: 1, bar: 0.3 }
  return { need: 2, bar: 0.5 }
}

function dealOnePlayer(
  used: Set<string>,
  biologies: Biology[],
  slots: string[],
  targetCoeff: number,
  random: () => number,
  forcedRare?: Biology | null,
): { biology: Biology; characteristics: Characteristic[] } | null {
  const weights = slots.map((cat) => characteristicWeight(cat, 'new'))
  const wTotal = weights.reduce((s, w) => s + w, 0)
  const targetSum = targetCoeff * wTotal
  const perk = highPerkThreshold(targetCoeff)
  const rareBiology = forcedRare === undefined ? generateRareBiology(biologies, random, targetCoeff) : forcedRare

  for (let attemptCount = 1; attemptCount <= MAX_ATTEMPTS; attemptCount += 1) {
    const order = shuffleArray([...slots])
    const attemptUsed = new Set(used)
    let currentSum = 0
    let highPerkCount = 0
    let biology: Biology | null = null
    const characteristics: Characteristic[] = []
    let failed = false

    for (let i = 0; i < order.length; i += 1) {
      const category = order[i]
      const w = characteristicWeight(category, 'new')
      const range = slotMinMax(category)
      const rest = remainingBounds(order, i + 1)
      let vmin = Math.max(range.min, (targetSum - currentSum - rest.maxW) / w)
      let vmax = Math.min(range.max, (targetSum - currentSum - rest.minW) / w)

      const last = i === order.length - 1
      const remainSlots = order.length - i
      const missingPerks = Math.max(0, perk.need - highPerkCount)
      if (!last && missingPerks > 0 && remainSlots === missingPerks) {
        vmin = Math.max(vmin, perk.bar)
      }

      if (vmin > vmax + 1e-9) {
        failed = true
        break
      }

      let raw: number
      if (last) raw = (targetSum - currentSum) / w
      else if (i < 4) {
        raw = attemptCount <= 100 ? sampleWShape(vmin, vmax, random) : sampleTruncatedNormal(vmin, vmax, random)
      } else raw = sampleUniform(vmin, vmax, random)

      const value = clampCoef(raw, range.min, range.max)

      if (category === BIOLOGY_CATEGORY) {
        const rare = rareBiology
        if (rare) {
          if (rare.coef < vmin - 1e-9 || rare.coef > vmax + 1e-9) {
            failed = true
            break
          }
          biology = rare
        } else {
          biology = generateOrdinaryBiology(value, random)
        }
        if (biology.coef >= 0.5) highPerkCount += 1
        currentSum += biology.coef * w
        continue
      }

      const variant = pickVariant(category, value, attemptUsed, 'new')
      if (!variant) {
        failed = true
        break
      }
      if (last && Math.abs(variant.coef - value) > 0.001) {
        failed = true
        break
      }
      const char = variantToChar(variant, category)
      characteristics.push(char)
      attemptUsed.add(char.value)
      if (char.coef >= 0.5) highPerkCount += 1
      currentSum += char.coef * w
    }

    if (failed || !biology) continue
    if (highPerkCount < perk.need) continue
    const avg = currentSum / wTotal
    if (avg < targetCoeff - 0.08 || avg > targetCoeff + 0.08) continue
    assignOccurrences(characteristics)
    return { biology, characteristics }
  }
  if (rareBiology) {
    // A rare negative biology must not vanish or leave the player's hand empty
    // when the requested overall coefficient cannot be reached with it.
    const fallback = dealOnePlayer(used, biologies, slots, targetCoeff, random, null)
    if (fallback) return { ...fallback, biology: rareBiology }
  }
  return null
}

export function dealNewModeToPlayers(players: Player[], opts: DealOptions): void {
  const program = (opts.noPhobias
    ? ['Профессия', 'Здоровье', 'Хобби', 'Багаж', 'Факт']
    : ['Профессия', 'Здоровье', 'Хобби', 'Фобия', 'Багаж', 'Факт']
  ) as CharacteristicCategory[]
  if (opts.extraBaggage) {
    const idx = program.lastIndexOf('Багаж')
    program.splice(idx + 1, 0, 'Багаж')
  }
  const slots = [...program]
  const bioIndex = 2
  slots.splice(bioIndex, 0, BIOLOGY_CATEGORY)

  const used = new Set<string>()
  const biologies: Biology[] = []
  const randomTarget = opts.targetCoef === null

  for (const player of players) {
    const target = randomTarget ? -0.2 + Math.random() * 1.1 : (opts.targetCoef ?? 0.5)
    const dealt = dealOnePlayer(used, biologies, slots, target, Math.random)
    if (!dealt) {
      const fallback = generateOrdinaryBiology()
      player.biology = fallback
      player.characteristics = []
      continue
    }
    biologies.push(dealt.biology)
    for (const ch of dealt.characteristics) used.add(ch.value)
    player.biology = dealt.biology
    player.characteristics = dealt.characteristics
  }
}

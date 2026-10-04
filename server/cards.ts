import type {
  ActionCard,
  CardPickSpec,
  CardStage,
  CardsPower,
  GameMode,
  Player,
} from '../shared/types'
import { characteristicWeight } from './characteristics'
import { readJson } from './loadJson'

/**
 * Загрузка каталога карт действия из JSON и раздача карт
 * игрокам по коэффициенту их набора характеристик.
 */

export interface CardDef {
  cardId: string
  category: string
  title: string
  code: string
  action: string
  target: string
  scope: string
  picks: number
  stage: CardStage
  unique: boolean
  note: string
  /** Вероятности категории по 7 корзинам КФ. */
  probs: number[]
}

interface CardFile {
  cards: {
    id: string
    category: string
    title: string
    code: string
    action: string
    target: string
    scope: string
    picks: number
    stage: string
    unique: boolean
    note?: string
  }[]
}

let cache: CardDef[] | null = null

export function loadCards(): CardDef[] {
  if (cache) return cache
  const cards = readJson<CardFile>('action-cards.json').cards ?? []
  const probabilities = readJson<Record<string, number[]>>('action-card-probabilities.json')
  for (const [category, weights] of Object.entries(probabilities)) {
    if (!Array.isArray(weights) || weights.length !== 7 ||
      weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
      throw new Error(`Категория ${category}: нужны 7 конечных неотрицательных весов карт`)
    }
  }
  cache = cards
    .filter((r) => r.id && r.code)
    .map((r) => {
      if (!probabilities[r.category]) {
        throw new Error(`Для категории ${r.category} отсутствуют веса карт`)
      }
      return {
        cardId: r.id,
        category: r.category,
        title: r.title,
        code: r.code,
        action: r.action,
        target: r.target,
        scope: r.scope,
        picks: Number(r.picks) || 0,
        stage: (r.stage as CardStage) ?? 'any',
        unique: !!r.unique,
        note: r.note ?? '',
        probs: [...probabilities[r.category]],
      }
    })
  return cache
}

/** Индекс корзины КФ (0..6) по порогам ≤0.25,≤0.35,≤0.4,≤0.45,≤0.5,≤0.6,>0.6. */
function coefBucket(coef: number): number {
  if (coef <= 0.25) return 0
  if (coef <= 0.35) return 1
  if (coef <= 0.4) return 2
  if (coef <= 0.45) return 3
  if (coef <= 0.5) return 4
  if (coef <= 0.6) return 5
  return 6
}

/** Только непустые категории каталога; S сильнее A, старый порядок сохранён. */
function categories(defs: CardDef[]): string[] {
  const seen: string[] = []
  for (const d of defs) if (!seen.includes(d.category)) seen.push(d.category)
  const rank = new Map(['S', 'A', 'B', 'D', 'C'].map((category, index) => [category, index]))
  return seen.sort(
    (a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
  )
}

/**
 * Вес категории для данной корзины КФ с учётом влияния карт.
 * Меньшие корзины смещены к сильным категориям S/A, большие — к слабым.
 */
function bucketWithPower(bucket: number, power: CardsPower): number {
  if (power === 'strong') return Math.max(0, bucket - 2)
  if (power === 'weak') return Math.min(6, bucket + 2)
  return bucket
}

/** Один бросок [0, 1): категория определяется интервалом накопленной вероятности.
 * Порядок интервалов S/A/B/D/C не означает отдельные попытки выдать каждую категорию.
 * Веса доступных категорий нормализуются, в том числе после достижения лимита S.
 */
export function rollCategory(
  defs: CardDef[],
  coef: number,
  power: CardsPower,
  random: () => number = Math.random,
): string {
  const cats = categories(defs)
  const bucket = bucketWithPower(coefBucket(coef), power)
  const weights = cats.map((cat) => {
    const first = defs.find((d) => d.category === cat)
    return Math.max(0, first?.probs[bucket] ?? 0)
  })
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) {
    console.warn(`Для корзины КФ ${bucket} не заданы вероятности категорий карт`)
    return cats[0] ?? ''
  }
  const roll = random()
  let cumulativeWeight = 0
  for (let i = 0; i < cats.length; i++) {
    cumulativeWeight += weights[i]
    // Полуоткрытые интервалы: например S [0, 0.15), A [0.15, 0.4).
    if (weights[i] > 0 && roll < cumulativeWeight / total) return cats[i]
  }
  // Защита от погрешностей: нулевой вес никогда не должен дать карту.
  for (let i = cats.length - 1; i >= 0; i--) {
    if (weights[i] > 0) return cats[i]
  }
  return ''
}

/** Спецификации выборов для UI по коду/параметрам карты. */
export function pickSpecsFor(def: CardDef): CardPickSpec[] {
  const specs: CardPickSpec[] = []
  const exceptSelf = /кроме себя/i.test(`${def.title} ${def.note}`) || def.target === 'lastOpened'
  const revealedOnly = /открыт/i.test(`${def.title} ${def.note}`)

  if (def.action === 'swap' && def.scope === 'fixed') {
    const categories = def.target === 'item' ? ['Багаж'] : undefined
    specs.push({ kind: 'player', label: 'С кем вы хотите обменяться?', excludeSelf: true })
    specs.push({
      kind: 'characteristic',
      label: def.target === 'item'
        ? 'Что вы отдаёте: выберите свой открытый багаж'
        : 'Что вы отдаёте: выберите свою открытую характеристику',
      categories,
      revealedOnly: true,
      characteristicOwner: 'self',
    })
    specs.push({
      kind: 'characteristic',
      label: def.target === 'item'
        ? 'Что получаете: выберите открытый багаж другого игрока'
        : 'Что получаете: выберите открытую характеристику той же категории',
      categories,
      revealedOnly: true,
      characteristicOwner: 'selectedPlayer',
      matchPreviousCategory: def.target === 'any',
    })
    return specs
  }

  if ((def.action === 'change' && def.target === 'any' && def.scope === 'all') ||
    def.action === 'shuffleRevealed' || def.action === 'biasedReroll') {
    specs.push({ kind: 'catCategory', label: 'Выберите категорию характеристики',
      wholeCategory: def.action === 'shuffleRevealed' })
    return specs
  }

  if (def.action === 'change' && def.scope === 'self' && (def.target === 'factItem' || def.target === 'item' || def.target === 'fact')) {
    const cats =
      def.target === 'factItem' ? ['Факт', 'Багаж'] : def.target === 'item' ? ['Багаж'] : ['Факт']
    specs.push({
      kind: 'characteristic',
      label: def.target === 'factItem' ? 'Выберите факт или багаж для замены' : 'Выберите характеристику',
      categories: cats,
    })
    return specs
  }

  if (def.action === 'change' && def.scope === 'fixed') {
    specs.push({
      kind: 'player',
      label: exceptSelf ? 'Выберите игрока (не себя)' : 'Выберите игрока',
      excludeSelf: exceptSelf,
    })
    if (def.target === 'lastOpened') return specs
    if (def.target === 'any') {
      const n = /any2/i.test(def.code) || /2\s*люб/i.test(def.title) ? 2 : Math.max(1, (def.picks - 1) || 1)
      for (let i = 0; i < n; i++) {
        specs.push({
          kind: 'characteristic',
          label: n > 1 ? `Выберите характеристику (${i + 1})` : 'Выберите характеристику',
          revealedOnly,
        })
      }
    } else if (def.target === 'item' || def.target === 'fact' || def.target === 'factItem') {
      const cats =
        def.target === 'factItem' ? ['Факт', 'Багаж'] : def.target === 'item' ? ['Багаж'] : ['Факт']
      specs.push({
        kind: 'characteristic',
        label: 'Выберите характеристику',
        categories: cats,
      })
    }
    // job / health / biology — категория известна, достаточно игрока
    return specs
  }

  if (def.action === 'removeThreat') {
    specs.push({ kind: 'threat', label: 'Выберите угрозу для удаления' })
    return specs
  }

  for (let i = 0; i < def.picks; i++) {
    specs.push({
      kind: 'player',
      label: def.picks > 1 ? `Выберите игрока (${i + 1})` : 'Выберите игрока',
      excludeSelf: def.action === 'selfProtection',
    })
  }
  return specs
}

function toActionCard(def: CardDef, instanceId: string): ActionCard {
  return {
    instanceId,
    cardId: def.cardId,
    category: def.category,
    title: def.title,
    code: def.code,
    action: def.action,
    target: def.target,
    scope: def.scope,
    picks: def.picks,
    stage: def.stage,
    pickSpecs: pickSpecsFor(def),
    note: def.note,
    used: false,
  }
}

/**
 * Раздаёт каждому игроку по 1 карте: ролл категории по КФ набора, затем
 * случайная карта из категории. Уникальные карты (unique) не повторяются
 * между игроками; дубликаты (unique=false) — можно повторять.
 */
export function dealActionCards(
  players: Player[],
  power: CardsPower,
  mode: GameMode = 'classic',
  random: () => number = Math.random,
): Map<string, ActionCard> {
  const defs = loadCards()
  const result = new Map<string, ActionCard>()
  if (defs.length === 0) return result

  let instanceCounter = 1
  const count = (category: string) => [...result.values()].filter(c => c.category === category).length
  const available = () => defs.filter(d =>
    (!d.unique || ![...result.values()].some(c => c.cardId === d.cardId)),
  )
  const choose = (pool: CardDef[]) => pool[Math.floor(random() * pool.length)]

  for (const player of players) {
    const coef = averageCoef(player, mode)
    // Не больше двух S и двух A; ограничения действуют и при нулевых весах/фолбэке.
    const pool = available().filter(d => !['S', 'A'].includes(d.category) || count(d.category) < 2)
    if (!pool.length) continue
    const category = rollCategory(pool, coef, power, random)
    const def = choose(pool.filter(d => d.category === category))
    const instanceId = `ci_${String(instanceCounter++).padStart(3, '0')}`
    result.set(player.id, toActionCard(def, instanceId))
  }

  return result
}

/** Выдаёт конкретную карту по cardId (админ-тест). */
export function makeCardByCatalogId(cardId: string, instanceId: string): ActionCard | null {
  const def = loadCards().find((d) => d.cardId === cardId)
  if (!def) return null
  return toActionCard(def, instanceId)
}

/** Средний коэффициент набора характеристик игрока (для ролла категории). */
export function averageCoef(player: Player, mode: GameMode = 'classic'): number {
  let weightedSum = 0
  let totalWeight = 0
  for (const characteristic of player.characteristics) {
    const weight = characteristicWeight(characteristic.type, mode)
    weightedSum += characteristic.coef * weight
    totalWeight += weight
  }
  if (player.biology) {
    const weight = characteristicWeight('Биология', mode)
    weightedSum += player.biology.coef * weight
    totalWeight += weight
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0.5
}

/** Полный каталог для админ-панели. */
export function cardCatalog(): CardDef[] {
  return loadCards()
}

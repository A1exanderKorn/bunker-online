import * as XLSX from 'xlsx'
import { DATA_PATH } from './config'
import type {
  ActionCard,
  CardPickSpec,
  CardStage,
  CardsPower,
  Player,
} from '../shared/types'

/**
 * Загрузка каталога карт действия из 2-го листа data.xlsx и раздача карт
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

interface CardRow {
  id: string
  category: string
  title: string
  code: string
  action: string
  target: string
  scope: string
  picks: number
  stage: string
  unique: number
  prob025: number
  prob035: number
  prob04: number
  prob045: number
  prob05: number
  prob06: number
  prob06p: number
  note?: string
}

const SHEET = 'Карты действия'

let cache: CardDef[] | null = null

export function loadCards(): CardDef[] {
  if (cache) return cache
  const wb = XLSX.readFile(DATA_PATH)
  const sheet = wb.Sheets[SHEET]
  if (!sheet) {
    cache = []
    return cache
  }
  const rows = XLSX.utils.sheet_to_json<CardRow>(sheet)
  cache = rows
    .filter((r) => r.id && r.code)
    .map((r) => ({
      cardId: r.id,
      category: r.category,
      title: r.title,
      code: r.code,
      action: r.action,
      target: r.target,
      scope: r.scope,
      picks: Number(r.picks) || 0,
      stage: (r.stage as CardStage) ?? 'any',
      unique: Number(r.unique) === 1,
      note: r.note ?? '',
      probs: [r.prob025, r.prob035, r.prob04, r.prob045, r.prob05, r.prob06, r.prob06p].map(
        (x) => Number(x) || 0,
      ),
    }))
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

/** Уникальные категории каталога (в порядке появления). */
function categories(defs: CardDef[]): string[] {
  const seen: string[] = []
  for (const d of defs) if (!seen.includes(d.category)) seen.push(d.category)
  const rank = new Map(['A', 'B', 'C', 'D'].map((category, index) => [category, index]))
  return seen.sort(
    (a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
  )
}

/**
 * Вес категории для данной корзины КФ с учётом влияния карт.
 * Меньшие корзины смещены к сильной категории A, большие — к слабым.
 */
function bucketWithPower(bucket: number, power: CardsPower): number {
  if (power === 'strong') return Math.max(0, bucket - 2)
  if (power === 'weak') return Math.min(6, bucket + 2)
  return bucket
}

/** Ролл категории A → B → C → D по весам K–Q из первой карты каждой категории. */
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
  let rnd = random() * total
  for (let i = 0; i < cats.length; i++) {
    if (rnd < weights[i]) return cats[i]
    rnd -= weights[i]
  }
  return cats[cats.length - 1]
}

/** Спецификации выборов для UI по коду/параметрам карты. */
export function pickSpecsFor(def: CardDef): CardPickSpec[] {
  const specs: CardPickSpec[] = []
  const exceptSelf = /кроме себя/i.test(`${def.title} ${def.note}`) || def.target === 'lastOpened'
  const revealedOnly = /открыт/i.test(`${def.title} ${def.note}`)

  if (def.action === 'swap' && def.scope === 'fixed') {
    specs.push({ kind: 'player', label: 'Выберите игрока для обмена', excludeSelf: true })
    if (def.target === 'any') {
      specs.push({
        kind: 'characteristic',
        label: 'Выберите открытую характеристику',
        revealedOnly: true,
      })
    } else if (def.target === 'item') {
      specs.push({
        kind: 'characteristic',
        label: 'Выберите багаж для обмена',
        categories: ['Багаж'],
        revealedOnly: true,
      })
    }
    return specs
  }

  if (def.action === 'change' && def.target === 'any' && def.scope === 'all') {
    specs.push({ kind: 'catCategory', label: 'Выберите категорию характеристики' })
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
export function dealActionCards(players: Player[], power: CardsPower): Map<string, ActionCard> {
  const defs = loadCards()
  const result = new Map<string, ActionCard>()
  if (defs.length === 0) return result

  const usedUnique = new Set<string>()
  let instanceCounter = 1

  for (const player of players) {
    const coef = averageCoef(player)
    let def: CardDef | undefined

    // Несколько попыток подобрать категорию/карту без коллизии уникальности.
    for (let attempt = 0; attempt < 12 && !def; attempt++) {
      const cat = rollCategory(defs, coef, power)
      let pool = defs.filter((d) => d.category === cat)
      // Убираем уже занятые уникальные карты.
      pool = pool.filter((d) => !(d.unique && usedUnique.has(d.cardId)))
      if (pool.length === 0) continue
      def = pool[Math.floor(Math.random() * pool.length)]
    }
    // Фолбэк: любая доступная карта.
    if (!def) {
      const pool = defs.filter((d) => !(d.unique && usedUnique.has(d.cardId)))
      def = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : defs[0]
    }

    if (def.unique) usedUnique.add(def.cardId)
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
export function averageCoef(player: Player): number {
  const coefs: number[] = player.characteristics.map((c) => c.coef)
  if (player.biology) coefs.push(player.biology.coef)
  if (coefs.length === 0) return 0.5
  return coefs.reduce((a, b) => a + b, 0) / coefs.length
}

/** Полный каталог для админ-панели. */
export function cardCatalog(): CardDef[] {
  return loadCards()
}

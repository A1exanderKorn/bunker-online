import { readJson } from './loadJson'

/**
 * Каталог бункера: катастрофы, угрозы и доп. условия из JSON.
 */

export interface BunkerData {
  threats: string[]
  catastrophes: string[]
  conditions: string[]
  challenges: BunkerChallenge[]
}

export interface BunkerChallenge {
  id: string
  kind: 'threat' | 'catastrophe' | 'condition'
  text: string
  /** Каждая группа обязательна; внутри группы достаточно одного тега. */
  requirements: string[][]
  grants: string[]
  successDelta: number
  failureDelta: number
}

interface BunkerFile {
  items: {
    id: string
    text: string
    requirements: string[][]
    grants: string[]
    successDelta: number
    failureDelta: number
  }[]
}

let cache: BunkerData | null = null

function loadKind(kind: BunkerChallenge['kind'], file: string): BunkerChallenge[] {
  const items = readJson<BunkerFile>(`bunker/${file}`).items ?? []
  return items
    .filter((item) => String(item.text ?? '').trim())
    .map((item) => ({
      id: String(item.id ?? ''),
      kind,
      text: String(item.text).trim(),
      requirements: Array.isArray(item.requirements) ? item.requirements : [],
      grants: Array.isArray(item.grants) ? item.grants : [],
      successDelta: Number(item.successDelta) || 0,
      failureDelta: Number(item.failureDelta) || 0,
    }))
}

export function loadBunkerData(): BunkerData {
  if (cache) return cache
  const catastrophes = loadKind('catastrophe', 'catastrophes.json')
  const threats = loadKind('threat', 'threats.json')
  const conditions = loadKind('condition', 'conditions.json')
  const challenges = [...catastrophes, ...threats, ...conditions]
  cache = {
    catastrophes: catastrophes.map((item) => item.text),
    threats: threats.map((item) => item.text),
    conditions: conditions.map((item) => item.text),
    challenges,
  }
  return cache
}

export function challengeByText(text: string): BunkerChallenge | undefined {
  return loadBunkerData().challenges.find((challenge) => challenge.text === text)
}

/** Возвращает перемешанную копию массива (не мутирует исходный). */
function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Случайная катастрофа (стартовое условие). */
export function pickCatastrophe(): string {
  const data = loadBunkerData()
  if (data.catastrophes.length === 0) return 'Неизвестная катастрофа'
  return data.catastrophes[Math.floor(Math.random() * data.catastrophes.length)]
}

/**
 * Возвращает перемешанную очередь уникальных угроз. Если запрошено больше,
 * чем есть в колоде, очередь заканчивается без перехода на второй круг.
 */
export function threatQueue(count: number): string[] {
  const data = loadBunkerData()
  if (data.threats.length === 0) return []
  const uniqueThreats = [...new Set(data.threats)]
  return shuffled(uniqueThreats).slice(0, Math.max(0, count))
}

/** Случайное дополнительное условие, которого ещё нет в бункере. */
export function pickUnusedCondition(openedTexts: Iterable<string>): string | undefined {
  const opened = new Set(openedTexts)
  const available = [...new Set(loadBunkerData().conditions)].filter((text) => !opened.has(text))
  if (available.length === 0) return undefined
  return available[Math.floor(Math.random() * available.length)]
}

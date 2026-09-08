import type { BunkerState, PublicBunkerChallenge } from '../shared/types'
import { readJson } from './loadJson'
import { labelTag, labelTagGroups } from './tagLabels'

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
  title: string
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
    title?: string
    text: string
    requirements: string[][]
    grants: string[]
    successDelta: number
    failureDelta: number
  }[]
}

function deriveTitle(text: string): string {
  const colon = text.match(/^([^:]{2,48}):\s/)
  if (colon) return colon[1].trim()
  const sentence = text.match(/^([^.!?]{2,72})[.!?]/)
  if (sentence) return sentence[1].trim()
  return text.slice(0, 48).trim()
}

function loadKind(kind: BunkerChallenge['kind'], file: string): BunkerChallenge[] {
  const items = readJson<BunkerFile>(`bunker/${file}`).items ?? []
  return items
    .filter((item) => String(item.text ?? '').trim())
    .map((item) => {
      const text = String(item.text).trim()
      const title = String(item.title ?? '').trim() || deriveTitle(text)
      return {
        id: String(item.id ?? ''),
        kind,
        title,
        text,
        requirements: Array.isArray(item.requirements) ? item.requirements : [],
        grants: Array.isArray(item.grants) ? item.grants : [],
        successDelta: Number(item.successDelta) || 0,
        failureDelta: Number(item.failureDelta) || 0,
      }
    })
}

let cache: BunkerData | null = null

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

const FLAVOR_MARKERS = ['Для решения нужны одновременно:', 'Для решения подойдёт:']

/** Сюжет без хвоста «Для решения…». */
export function challengeFlavor(text: string): string {
  if (!text) return ''
  let cut = -1
  for (const marker of FLAVOR_MARKERS) {
    const index = text.indexOf(marker)
    if (index >= 0 && (cut < 0 || index < cut)) cut = index
  }
  return (cut < 0 ? text : text.slice(0, cut)).trim()
}

export interface StoredBunkerCondition {
  text: string
  byPlayerId: string
  byName: string
}

export interface StoredBunkerState {
  catastrophe: string
  years: number
  threats: string[]
  conditions: StoredBunkerCondition[]
}

export function toPublicChallenge(text: string): PublicBunkerChallenge {
  if (!text) return { flavor: '', requirements: [] }
  const challenge = challengeByText(text)
  return {
    flavor: challengeFlavor(text),
    requirements: labelTagGroups(challenge?.requirements ?? []),
  }
}

export function toPublicBunker(bunker: StoredBunkerState): BunkerState {
  return {
    catastrophe: toPublicChallenge(bunker.catastrophe),
    years: bunker.years,
    threats: bunker.threats.map(toPublicChallenge),
    conditions: bunker.conditions.map((condition) => {
      const challenge = challengeByText(condition.text)
      return {
        flavor: challengeFlavor(condition.text),
        grants: (challenge?.grants ?? []).map(labelTag),
        byPlayerId: condition.byPlayerId,
        byName: condition.byName,
      }
    }),
  }
}

/** Краткое имя катастрофы / угрозы / условия для истории карт. */
export function challengeTitle(text: string): string {
  if (!text) return ''
  return challengeByText(text)?.title || deriveTitle(text)
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

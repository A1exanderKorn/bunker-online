import type { BunkerState, GameMode, PublicBunkerChallenge } from '../shared/types'
import { readJson } from './loadJson'
import { labelTag, labelTagGroups } from './tagLabels'
import { isNewGameMode } from './data'

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

function bunkerDir(mode: GameMode = 'classic'): string {
  return isNewGameMode(mode) ? 'bunker-new' : 'bunker'
}

function loadKind(kind: BunkerChallenge['kind'], file: string, mode: GameMode = 'classic'): BunkerChallenge[] {
  const items = readJson<BunkerFile>(`${bunkerDir(mode)}/${file}`).items ?? []
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

const cache = new Map<string, BunkerData>()

export function loadBunkerData(mode: GameMode = 'classic'): BunkerData {
  const key = isNewGameMode(mode) ? 'new' : 'classic'
  const hit = cache.get(key)
  if (hit) return hit
  const catastrophes = loadKind('catastrophe', 'catastrophes.json', key)
  const threats = loadKind('threat', 'threats.json', key)
  const conditions = loadKind('condition', 'conditions.json', key)
  const challenges = [...catastrophes, ...threats, ...conditions]
  const data: BunkerData = {
    catastrophes: catastrophes.map((item) => item.text),
    threats: threats.map((item) => item.text),
    conditions: conditions.map((item) => item.text),
    challenges,
  }
  cache.set(key, data)
  return data
}

export function challengeByText(text: string, mode: GameMode = 'classic'): BunkerChallenge | undefined {
  return loadBunkerData(mode).challenges.find((challenge) => challenge.text === text)
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

export function toPublicChallenge(text: string, mode: GameMode = 'classic'): PublicBunkerChallenge {
  if (!text) return { flavor: '', requirements: [] }
  const challenge = challengeByText(text, mode)
  return {
    flavor: challengeFlavor(text),
    requirements: labelTagGroups(challenge?.requirements ?? [], mode),
  }
}

export function toPublicBunker(bunker: StoredBunkerState, mode: GameMode = 'classic'): BunkerState {
  return {
    catastrophe: toPublicChallenge(bunker.catastrophe, mode),
    years: bunker.years,
    threats: bunker.threats.map((text) => toPublicChallenge(text, mode)),
    conditions: bunker.conditions.map((condition) => {
      const challenge = challengeByText(condition.text, mode)
      return {
        flavor: challengeFlavor(condition.text),
        grants: (challenge?.grants ?? []).map((tag) => labelTag(tag, mode)),
        byPlayerId: condition.byPlayerId,
        byName: condition.byName,
      }
    }),
  }
}

/** Краткое имя катастрофы / угрозы / условия для истории карт. */
export function challengeTitle(text: string, mode: GameMode = 'classic'): string {
  if (!text) return ''
  return challengeByText(text, mode)?.title || deriveTitle(text)
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
export function pickCatastrophe(mode: GameMode = 'classic'): string {
  const data = loadBunkerData(mode)
  if (data.catastrophes.length === 0) return 'Неизвестная катастрофа'
  return data.catastrophes[Math.floor(Math.random() * data.catastrophes.length)]
}

export function threatQueue(count: number, mode: GameMode = 'classic'): string[] {
  const data = loadBunkerData(mode)
  if (data.threats.length === 0) return []
  const uniqueThreats = [...new Set(data.threats)]
  return shuffled(uniqueThreats).slice(0, Math.max(0, count))
}

export function pickUnusedCondition(openedTexts: Iterable<string>, mode: GameMode = 'classic'): string | undefined {
  const opened = new Set(openedTexts)
  const available = [...new Set(loadBunkerData(mode).conditions)].filter((text) => !opened.has(text))
  if (available.length === 0) return undefined
  return available[Math.floor(Math.random() * available.length)]
}

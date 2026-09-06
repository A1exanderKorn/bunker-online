import * as XLSX from 'xlsx'
import { DATA_PATH } from './config'

/**
 * Парсинг третьего листа Excel: «Угрозы, Катастрофы, Условия».
 * Столбцы определяются по заголовкам, поэтому порядок строк и добавление новых
 * катастроф/угроз/условий не влияют на парсинг.
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

function parseRequirements(value: unknown): string[][] {
  return String(value ?? '').split(';').map((group) =>
    group.split('|').map((tag) => tag.trim()).filter(Boolean),
  ).filter((group) => group.length > 0)
}

function parseTags(value: unknown): string[] {
  return String(value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
}

function numberValue(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function valueByHeaders(row: Record<string, unknown>, ...headers: string[]): unknown {
  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(row, header)) return row[header]
  }
  return undefined
}

function challengeKind(value: unknown): BunkerChallenge['kind'] | null {
  const type = String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/\./g, '')
  if (type.startsWith('катастроф')) return 'catastrophe'
  if (type.startsWith('угроз')) return 'threat'
  if (type.startsWith('доп') || type.startsWith('услов')) return 'condition'
  return null
}

const SHEET_NAME = 'Угрозы, Катастрофы, Условия'

let cache: BunkerData | null = null

export function loadBunkerData(): BunkerData {
  if (cache) return cache

  const workbook = XLSX.readFile(DATA_PATH)
  const sheet =
    workbook.Sheets[SHEET_NAME] ??
    workbook.Sheets[workbook.SheetNames.find((n) => n.includes('Угроз')) ?? '']
  if (!sheet) {
    cache = { threats: [], catastrophes: [], conditions: [], challenges: [] }
    return cache
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const threats: string[] = []
  const catastrophes: string[] = []
  const conditions: string[] = []
  const challenges: BunkerChallenge[] = []

  for (const [index, row] of rows.entries()) {
    const kind = challengeKind(valueByHeaders(row, 'Тип', 'type'))
    const text = String(valueByHeaders(row, 'Текст', 'text') ?? '').trim()
    if (!kind) continue
    if (!text) continue
    if (kind === 'threat') threats.push(text)
    else if (kind === 'catastrophe') catastrophes.push(text)
    else conditions.push(text)
    challenges.push({
      id: String(valueByHeaders(row, 'id', 'ID') || `${kind}_${index + 2}`),
      kind,
      text,
      requirements: parseRequirements(valueByHeaders(row, 'Требования (группы ;, варианты |)', 'Требования')),
      grants: parseTags(valueByHeaders(row, 'Даёт теги', 'Теги')),
      successDelta: numberValue(valueByHeaders(row, 'Успех, %', 'Успех')),
      failureDelta: numberValue(valueByHeaders(row, 'Провал, %', 'Провал')),
    })
  }

  cache = { threats, catastrophes, conditions, challenges }
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

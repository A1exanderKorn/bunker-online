import * as XLSX from 'xlsx'
import { DATA_PATH } from './config'

/**
 * Парсинг третьего листа Excel: «Угрозы, Катастрофы, Условия».
 * Формат: первый столбец — тип (Угроза/Катастрофа/Доп. Условия), второй — текст.
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

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
  const threats: string[] = []
  const catastrophes: string[] = []
  const conditions: string[] = []
  const challenges: BunkerChallenge[] = []

  for (const [index, row] of rows.entries()) {
    const type = (row?.[0] ?? '').toString().trim()
    const text = (row?.[1] ?? '').toString().trim()
    if (!type || !text) continue
    const kind = type.startsWith('Угроз') ? 'threat' : type.startsWith('Катастроф') ? 'catastrophe' : type.startsWith('Доп') ? 'condition' : null
    if (!kind) continue
    if (kind === 'threat') threats.push(text)
    else if (kind === 'catastrophe') catastrophes.push(text)
    else conditions.push(text)
    challenges.push({
      id: String(row?.[2] ?? `${kind}_${index + 1}`),
      kind,
      text,
      requirements: parseRequirements(row?.[3]),
      grants: parseTags(row?.[4]),
      successDelta: numberValue(row?.[5]),
      failureDelta: numberValue(row?.[6]),
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
 * Возвращает перемешанную очередь угроз нужной длины (уникальные, затем по кругу).
 * Используется, чтобы заранее подготовить угрозы для помеченных раундов.
 */
export function threatQueue(count: number): string[] {
  const data = loadBunkerData()
  if (data.threats.length === 0) return []
  const result: string[] = []
  let pool: string[] = []
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) pool = shuffled(data.threats)
    result.push(pool.pop()!)
  }
  return result
}

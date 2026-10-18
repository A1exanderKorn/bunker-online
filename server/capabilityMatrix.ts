import type { Biology, Characteristic, Player, CapabilityCoverage } from '../shared/types'
import { readJson } from './loadJson'
import { isBiologyInfertile } from './biology'

export type CapabilityVector = Record<string, number>
export interface CapabilityMatrix {
  version: number
  scaling: { baseSurvivors: number; exponent: number }
  aliases: Record<string, string>
  dimensions: Record<string, { label: string; unique: boolean }>
  characteristics: Record<string, Record<string, CapabilityVector>>
  conditions: Record<string, CapabilityVector>
  biology: { android: CapabilityVector; infertile: CapabilityVector }
  challenges: Record<string, CapabilityVector>
}
let cache: CapabilityMatrix | null = null

export function validateMatrix(matrix: CapabilityMatrix): void {
  if (matrix.version !== 1 || !Number.isFinite(matrix.scaling?.baseSurvivors) || matrix.scaling.baseSurvivors < 1 ||
      !Number.isFinite(matrix.scaling.exponent) || matrix.scaling.exponent < 0 || matrix.scaling.exponent > 1) throw Error('Некорректная версия/масштабирование матрицы')
  for (const [key, dimension] of Object.entries(matrix.dimensions)) {
    if (!dimension.label || typeof dimension.unique !== 'boolean') throw Error(`Некорректная шкала ${key}`)
  }
  const vectors = [
    ...Object.values(matrix.characteristics).flatMap(rows=>Object.entries(rows)),
    ...Object.entries(matrix.conditions), ...Object.entries(matrix.biology), ...Object.entries(matrix.challenges),
  ]
  for (const [name, vector] of vectors) for (const [tag, value] of Object.entries(vector)) {
    if (!matrix.dimensions[tag] || !Number.isFinite(value) || value <= 0 || value > 100) throw Error(`Матрица ${name}/${tag}: требуется значение (0, 100] и известная шкала`)
  }
}

export function loadCapabilityMatrix(): CapabilityMatrix {
  if (!cache) {
    const data = readJson<CapabilityMatrix>('capability-matrix.json')
    validateMatrix(data)
    cache = data
  }
  return cache
}

/** Пустая строка — честные 0%, а не неявное превращение тегов в навыки. */
export function characteristicCapabilities(item: Pick<Characteristic, 'type' | 'value'>): CapabilityVector {
  return loadCapabilityMatrix().characteristics[item.type]?.[item.value] ?? {}
}

export function biologyCapabilities(bio: Biology | null): CapabilityVector {
  if (!bio) return {}
  const matrix = loadCapabilityMatrix()
  if (bio.sex === 'Андроид') return { ...matrix.biology.android }
  return isBiologyInfertile(bio) ? { ...matrix.biology.infertile } : {}
}

export function teamDivisor(count: number): number {
  const { baseSurvivors, exponent } = loadCapabilityMatrix().scaling
  return Math.max(1, Math.pow(Math.max(0, count) / baseSurvivors, exponent))
}

export interface CapabilityTeam {
  values: CapabilityVector
  rawPlayers: CapabilityVector
  conditions: CapabilityVector
  divisor: number
  sources: Record<string, { source: string; amount: number }[]>
}

export function buildCapabilityTeam(players: Player[], conditions: { id: string; title: string }[]): CapabilityTeam {
  const matrix = loadCapabilityMatrix()
  const alive = players.filter(p=>p.isAlive)
  const team: CapabilityTeam = { values: {}, rawPlayers: {}, conditions: {}, divisor: teamDivisor(alive.length), sources: {} }
  const add = (vector: CapabilityVector, source: string, target: CapabilityVector, divisor: number) => {
    for (const [tag, amount] of Object.entries(vector)) {
      const unique = matrix.dimensions[tag].unique
      target[tag] = unique ? Math.max(target[tag] ?? 0, amount) : (target[tag] ?? 0) + amount
      ;(team.sources[tag] ??= []).push({ source, amount: amount / (unique ? 1 : divisor) })
    }
  }
  for (const player of alive) {
    for (const item of player.characteristics) add(characteristicCapabilities(item), `${player.name}: ${item.value}`, team.rawPlayers, team.divisor)
    add(biologyCapabilities(player.biology), `${player.name}: биология`, team.rawPlayers, team.divisor)
  }
  // Бункерные модули имеют групповую вместимость; их вклад не делим на число людей.
  const seen = new Set<string>()
  for (const condition of conditions) {
    if (seen.has(condition.id)) continue
    seen.add(condition.id)
    add(matrix.conditions[condition.id] ?? {}, `Бункер: ${condition.title}`, team.conditions, 1)
  }
  for (const [tag, dimension] of Object.entries(matrix.dimensions)) {
    team.values[tag] = dimension.unique
      ? Math.max(team.rawPlayers[tag] ?? 0, team.conditions[tag] ?? 0)
      : (team.rawPlayers[tag] ?? 0) / team.divisor + (team.conditions[tag] ?? 0)
  }
  return team
}

export function capabilityCoverage(requirements: CapabilityVector, supply: CapabilityVector): CapabilityCoverage[] {
  const matrix = loadCapabilityMatrix()
  return Object.entries(requirements).map(([tag, required]) => {
    const available = Math.max(0, supply[tag] ?? 0)
    return { tag, label: matrix.dimensions[tag].label, required, available,
      coverage: Math.min(1, available / required), missing: Math.max(0, required - available) }
  })
}

/** Суммарный взвешенный дефицит; избыток одной шкалы не покрывает другую. */
export function capabilityDeficit(coverage: CapabilityCoverage[]): number {
  const required = coverage.reduce((sum, item)=>sum + item.required, 0)
  return required ? coverage.reduce((sum,item)=>sum + item.missing,0) / required : 0
}

export function publicCapabilities(vector: CapabilityVector): { tag: string; label: string; percent: number }[] {
  return Object.entries(vector).map(([tag, percent])=>({ tag, label: loadCapabilityMatrix().dimensions[tag].label, percent }))
}

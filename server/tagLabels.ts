import { readJson } from './loadJson'
import type { GameMode } from '../shared/types'
import { isNewGameMode } from './data'

const cache = new Map<string, Record<string, string>>()

export function loadTagLabels(mode: GameMode = 'classic'): Record<string, string> {
  const key = isNewGameMode(mode) ? 'new' : 'classic'
  const hit = cache.get(key)
  if (hit) return hit
  const file = key === 'new' ? 'tag-labels-new.json' : 'tag-labels.json'
  const labels = readJson<Record<string, string>>(file)
  cache.set(key, labels)
  return labels
}

export function labelTag(tag: string, mode: GameMode = 'classic'): string {
  return loadTagLabels(mode)[tag] ?? tag
}

export function labelTagGroups(groups: string[][], mode: GameMode = 'classic'): string[][] {
  return groups.map((group) => group.map((tag) => labelTag(tag, mode)))
}

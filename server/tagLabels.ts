import { readJson } from './loadJson'
import type { GameMode } from '../shared/types'

let cache: Record<string, string> | null = null

export function loadTagLabels(_mode: GameMode = 'classic'): Record<string, string> {
  if (!cache) cache = readJson<Record<string, string>>('tag-labels.json')
  return cache
}

export function labelTag(tag: string, mode: GameMode = 'classic'): string {
  return loadTagLabels(mode)[tag] ?? tag
}

export function labelTagGroups(groups: string[][], mode: GameMode = 'classic'): string[][] {
  return groups.map((group) => group.map((tag) => labelTag(tag, mode)))
}

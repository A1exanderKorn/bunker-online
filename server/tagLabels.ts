import { readJson } from './loadJson'

let cache: Record<string, string> | null = null

export function loadTagLabels(): Record<string, string> {
  if (cache) return cache
  cache = readJson<Record<string, string>>('tag-labels.json')
  return cache
}

export function labelTag(tag: string): string {
  return loadTagLabels()[tag] ?? tag
}

export function labelTagGroups(groups: string[][]): string[][] {
  return groups.map((group) => group.map(labelTag))
}

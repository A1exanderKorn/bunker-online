/** Структура списка закрытия по уже подписанным тегам. */
export type RequirementsView =
  | { kind: 'none'; heading: string }
  | { kind: 'single'; heading: string; label: string }
  | { kind: 'or'; heading: string; labels: string[] }
  | {
      kind: 'and'
      heading: string
      items: Array<{ kind: 'tag'; label: string } | { kind: 'or'; labels: string[] }>
    }

export function requirementsView(requirements: string[][]): RequirementsView {
  if (requirements.length === 0) {
    return { kind: 'none', heading: 'Особые навыки не нужны.' }
  }
  if (requirements.length === 1) {
    const group = requirements[0]
    if (group.length <= 1) {
      return {
        kind: 'single',
        heading: 'Чтобы закрыть, нужна характеристика:',
        label: group[0] ?? '',
      }
    }
    return {
      kind: 'or',
      heading: 'Чтобы закрыть, достаточно одной из характеристик:',
      labels: group,
    }
  }
  return {
    kind: 'and',
    heading: 'Чтобы закрыть, нужны все пункты одновременно:',
    items: requirements.map((group) =>
      group.length <= 1
        ? { kind: 'tag' as const, label: group[0] ?? '' }
        : { kind: 'or' as const, labels: group },
    ),
  }
}

export type GrantsView =
  | { kind: 'empty'; heading: string }
  | { kind: 'list'; heading: string; labels: string[] }

export function grantsView(grants: string[]): GrantsView {
  if (grants.length === 0) return { kind: 'empty', heading: 'Ничего не даёт.' }
  return { kind: 'list', heading: 'Приобретено:', labels: grants }
}

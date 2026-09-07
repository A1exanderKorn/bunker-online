import {
  BIOLOGY_CATEGORY,
  type CardHistoryCharChange,
  type CardHistoryEntry,
  type GameStage,
  type Player,
} from '../shared/types'

/** Полная запись истории на сервере (значения не режем, флагов публичности нет). */
export type StoredCardHistoryEntry = CardHistoryEntry

export function viewerIsPrivileged(
  change: Pick<CardHistoryCharChange, 'playerId'>,
  viewer: Player | undefined,
  owner: Player | undefined,
  stage: GameStage,
): boolean {
  if (stage === 'end') return true
  if (!viewer) return false
  if (viewer.id === change.playerId) return true
  if (!viewer.isAlive) return true
  if (owner && !owner.isAlive) return true
  return false
}

export function slotCurrentlyVisible(
  owner: Player | undefined,
  change: Pick<CardHistoryCharChange, 'slotType' | 'slotOcc'>,
): boolean {
  if (!owner) return false
  if (change.slotType === BIOLOGY_CATEGORY) return owner.biology?.isVisible ?? false
  const char = owner.characteristics.find(
    (item) => item.type === change.slotType && (item.occ ?? 0) === change.slotOcc,
  )
  return char?.isVisible ?? false
}

export function chipIsPublic(
  side: 'old' | 'new',
  change: Pick<CardHistoryCharChange, 'wasVisible' | 'slotType' | 'slotOcc'>,
  owner: Player | undefined,
  stage: GameStage,
  revealPrevious: boolean,
): boolean {
  if (stage === 'end') return true
  if (owner && !owner.isAlive) return true
  if (change.wasVisible) return true
  const nowVisible = slotCurrentlyVisible(owner, change)
  if (side === 'new') return nowVisible
  return revealPrevious && nowVisible
}

export function filterCardHistory(
  entries: StoredCardHistoryEntry[],
  viewer: Player | undefined,
  players: Player[],
  stage: GameStage,
  revealPrevious = false,
): CardHistoryEntry[] {
  return entries.map((entry) => ({
    ...entry,
    charChanges: entry.charChanges.map((change) => {
      const owner = change.playerId
        ? players.find((player) => player.id === change.playerId)
        : undefined
      const oldPublic = chipIsPublic('old', change, owner, stage, revealPrevious)
      const newPublic = chipIsPublic('new', change, owner, stage, revealPrevious)
      const privileged = viewerIsPrivileged(change, viewer, owner, stage)
      return {
        ...change,
        oldPublic,
        newPublic,
        oldValue: oldPublic || privileged ? change.oldValue : null,
        newValue: newPublic || privileged ? change.newValue : null,
      }
    }),
  }))
}

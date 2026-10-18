import type { CardHistoryCharChange, RerollAnimationSlot } from '../shared/types'
import { BIOLOGY_CATEGORY } from '../shared/types'
import { rowsByCategory } from './data'

/** Privacy is enforced before serialization, independently of the history visibility setting. */
export function rerollAnimationFor(
  changes: CardHistoryCharChange[], viewerId: string, revealAll: boolean, seq: number,
): RerollAnimationSlot[] {
  return changes.filter(c => c.oldValue !== null && c.newValue !== null && c.oldValue !== c.newValue &&
    (c.playerId === viewerId || revealAll || c.wasVisible)).map(c => {
    const pool = c.slotType === BIOLOGY_CATEGORY
      ? ['М, 25 лет', 'Ж, 35 лет', 'М, 62 года', 'Ж, 48 лет', 'М, 30 лет', 'Ж, 21 год', 'М, 75 лет', 'Ж, 54 года']
      : rowsByCategory(c.slotType).map(row => row.name)
    // Cosmetic sequence must not consume the gameplay RNG or sample other people's cards.
    const offset = [...c.playerId].reduce((n,s)=>n+s.charCodeAt(0),seq + c.slotOcc)
    const samples = Array.from({length:12},(_,i)=>pool[(offset+i*17)%pool.length]).filter(Boolean)
    return {playerId:c.playerId,category:c.slotType,occ:c.slotOcc,from:c.oldValue!,to:c.newValue!,samples}
  })
}

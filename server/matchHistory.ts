import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync, renameSync } from 'fs'
import { readdir, readFile, unlink } from 'fs/promises'
import path from 'path'
import type { Player, GameMode } from '../shared/types'
import { formatBiology, formatCharacteristicValue } from '../shared/types'
import type { StartingTrait } from '../shared/profile'
import { db } from './database'
import { averageCoef } from './cards'

export interface RecordedMatch {
  id: string; startedAt: string; finishedAt: string; playerCount: number; gameMode: GameMode
  targetCoef?: number | null; randomTargetCoef?: boolean | null
  players: { profileId: string; admitted: boolean; eliminationOrder: number | null; characteristics: StartingTrait[]; startingCoef?: number | null }[]
}

/** Independent snapshot, including participants later removed after disconnect. */
export class MatchRecorder {
  private id = randomUUID()
  private startedAt = new Date().toISOString()
  private finished = false
  private order = 0
  private participants: { playerId: string; profileId?: string; characteristics: StartingTrait[]; eliminationOrder: number | null; startingCoef: number }[]
  constructor(players: Player[], private gameMode: GameMode, private targetCoef: number | null = null, private randomTargetCoef: boolean | null = null) {
    this.participants = players.map(p => ({ playerId: p.id, profileId: p.profileId, eliminationOrder: null, startingCoef: averageCoef(p, gameMode),
      characteristics: [
        ...(p.biology ? [{ type: 'Биология', value: formatBiology(p.biology)!, coef: p.biology.coef }] : []),
        ...p.characteristics.map(c => ({ type: c.type + (p.characteristics.filter(x => x.type === c.type).length > 1 ? ` #${c.occ + 1}` : ''),
          value: formatCharacteristicValue(c)!, coef: c.coef })),
      ],
    }))
  }
  eliminate(id: string): void {
    const p = this.participants.find(p => p.playerId === id)
    if (!this.finished && p && p.eliminationOrder === null) p.eliminationOrder = ++this.order
  }
  finish(survivors: string[]): RecordedMatch | null {
    if (this.finished) return null
    this.finished = true
    return { id: this.id, startedAt: this.startedAt, finishedAt: new Date().toISOString(),
      playerCount: this.participants.length, gameMode: this.gameMode,
      targetCoef: this.targetCoef, randomTargetCoef: this.randomTargetCoef,
      players: this.participants.filter(p => p.profileId).map(p => ({ profileId: p.profileId!,
        admitted: survivors.includes(p.playerId), eliminationOrder: p.eliminationOrder,
        characteristics: p.characteristics.map(c => ({ ...c })),
        startingCoef: p.startingCoef,
      })),
    }
  }
}

const outbox = process.env.HISTORY_OUTBOX_DIR || path.resolve('.history-outbox')
let draining = false

/** Atomic transaction and stable match id make retries safe after a process restart. */
export async function persistMatch(match: RecordedMatch): Promise<void> {
  if (!db) throw new Error('Database is not configured')
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(`INSERT INTO matches (id,started_at,finished_at,player_count,game_mode,target_coef,random_target_coef)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [match.id, match.startedAt, match.finishedAt, match.playerCount, match.gameMode, match.targetCoef ?? null, match.randomTargetCoef ?? null])
    for (const p of match.players) {
      await client.query(`INSERT INTO match_players (match_id,profile_id,admitted,elimination_order,starting_traits,starting_coef)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (match_id,profile_id) DO NOTHING`,
        [match.id, p.profileId, p.admitted, p.eliminationOrder, JSON.stringify(p.characteristics), p.startingCoef ?? null])
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
export async function drainHistory(): Promise<void> {
  if (!db || draining) return
  draining = true
  try {
    for (const file of await readdir(outbox)) {
      if (!file.endsWith('.json')) continue
      const location = path.join(outbox, file)
      const match = JSON.parse(await readFile(location, 'utf8')) as RecordedMatch
      await persistMatch(match)
      await unlink(location)
    }
  } catch { console.error('History queue pending; PostgreSQL write will be retried') }
  finally { draining = false }
}
export function enqueueMatch(match: RecordedMatch | null): void {
  if (!match?.players.length || !db) return
  try {
    const location = path.join(outbox, `${match.id}.json`)
    writeFileSync(`${location}.tmp`, JSON.stringify(match), { mode: 0o600 })
    renameSync(`${location}.tmp`, location)
    void drainHistory()
  } catch { console.error('CRITICAL: failed to persist completed match to history outbox', match.id) }
}
export function startHistoryWriter(): void {
  if (!db) return
  mkdirSync(outbox, { recursive: true, mode: 0o700 })
  void drainHistory()
  setInterval(() => void drainHistory(), 10000).unref()
}

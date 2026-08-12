<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { BIOLOGY_CATEGORY, type Biology, type PublicPlayer } from '@shared/types'

/**
 * Игровое поле в виде адаптивной сетки карточек игроков.
 * Каждая карточка показывает вскрытые характеристики; свою карточку игрок
 * может раскрывать по одной характеристике — но только в свой ход.
 */
const game = useGameStore()
const { publicPlayers, myId, isVoting, amAlive, voteTally, votedIds, myVote, turn } =
  storeToRefs(game)

// Порядок строк характеристик (биология между «Здоровье» и «Хобби»).
const rows: string[] = ['Профессия', 'Здоровье', BIOLOGY_CATEGORY, 'Хобби', 'Фобия', 'Багаж', 'Факт']

function isMe(p: PublicPlayer) {
  return p.id === myId.value
}
function isCurrent(p: PublicPlayer) {
  return turn.value.currentPlayerId === p.id
}

function formatBiology(bio: Biology | null | undefined): string | null {
  if (!bio) return null
  return `${bio.sex}, ${bio.age} лет` + (bio.infertile ? ', бесплоден' : '')
}

/** Значение ячейки: свою строку показываем полностью, чужую — только вскрытое. */
function getValue(p: PublicPlayer, type: string): string | null {
  if (type === BIOLOGY_CATEGORY) {
    return formatBiology(isMe(p) ? game.myBiology : p.biology)
  }
  if (isMe(p)) {
    return game.myCharacteristics.find((c) => c.type === type)?.value ?? null
  }
  return p.characteristics.find((c) => c.type === type)?.value ?? null
}

function getHint(p: PublicPlayer, type: string): string | null {
  if (type === BIOLOGY_CATEGORY) {
    return (isMe(p) ? game.myBiology?.hint : p.biology?.hint) ?? null
  }
  const source = isMe(p) ? game.myCharacteristics : p.characteristics
  return source.find((c) => c.type === type)?.hint ?? null
}

function isRevealed(p: PublicPlayer, type: string): boolean {
  if (type === BIOLOGY_CATEGORY) {
    return isMe(p) ? !!game.myBiology?.isVisible : !!p.biology
  }
  if (isMe(p)) {
    return !!game.myCharacteristics.find((c) => c.type === type)?.isVisible
  }
  return !!p.characteristics.find((c) => c.type === type)
}

/** Можно ли вскрыть эту характеристику: моя, ещё не вскрыта, мой ход, лимит не исчерпан. */
function canReveal(p: PublicPlayer, type: string): boolean {
  return (
    isMe(p) &&
    !isRevealed(p, type) &&
    game.isMyTurn &&
    game.revealsLeftThisTurn > 0
  )
}

function tryReveal(p: PublicPlayer, type: string) {
  if (!canReveal(p, type)) return
  const label = type === BIOLOGY_CATEGORY ? 'Биология' : type
  if (!window.confirm(`Открыть характеристику «${label}» для всех?`)) return
  game.reveal(type as never)
}

function canVoteFor(p: PublicPlayer): boolean {
  return isVoting.value && amAlive.value && p.isAlive && !isMe(p)
}
function hasVoted(p: PublicPlayer): boolean {
  return votedIds.value.includes(p.id)
}

const displayPlayers = computed(() => publicPlayers.value)
</script>

<template>
  <div class="players-grid">
    <article
      v-for="p in displayPlayers"
      :key="p.id"
      class="player-card"
      :class="{
        self: isMe(p),
        dead: !p.isAlive,
        current: isCurrent(p),
        offline: !p.connected,
      }"
    >
      <header class="card-head">
        <div class="head-left">
          <span class="player-name">{{ p.name }}</span>
          <span v-if="isMe(p)" class="you-badge">вы</span>
          <span v-if="!p.connected" class="offline-badge" title="Игрок отключился">⚠</span>
        </div>
        <div class="head-right">
          <span v-if="isCurrent(p)" class="turn-badge">🎯 ходит</span>
          <span v-if="!p.isAlive" class="dead-badge">исключён</span>
          <span v-if="voteTally[p.id]" class="vote-count">{{ voteTally[p.id] }} 🗳</span>
        </div>
      </header>

      <ul class="char-list">
        <li
          v-for="type in rows"
          :key="type"
          class="char-row"
          :class="{
            revealed: isRevealed(p, type),
            clickable: canReveal(p, type),
            locked: isMe(p) && !isRevealed(p, type) && !canReveal(p, type),
          }"
          @click="tryReveal(p, type)"
        >
          <span class="char-type">{{ type === BIOLOGY_CATEGORY ? 'Биология' : type }}</span>
          <span class="char-value">
            <template v-if="isRevealed(p, type) || isMe(p)">
              {{ getValue(p, type) ?? '—' }}
            </template>
            <template v-else>
              <span class="hidden-dot">••••</span>
            </template>
          </span>
          <span v-if="canReveal(p, type)" class="reveal-cue" title="Нажмите, чтобы вскрыть">🔓</span>
          <span
            v-else-if="getHint(p, type) && (isRevealed(p, type) || isMe(p))"
            class="char-hint"
            :title="getHint(p, type) ?? ''"
            >ⓘ</span
          >
        </li>
      </ul>

      <footer v-if="isVoting" class="card-foot">
        <button
          v-if="canVoteFor(p)"
          class="vote-button"
          :class="{ voted: myVote === p.id }"
          @click="game.vote(p.id)"
        >
          {{ myVote === p.id ? '✓ Ваш голос' : 'Голосовать' }}
        </button>
        <span v-else-if="hasVoted(p)" class="voted-mark">проголосовал</span>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.players-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  width: 100%;
}
.player-card {
  background: #f5f5f7;
  border: 2px solid #d8d8de;
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.1s;
}
.player-card.self {
  border-color: #82b1ff;
  background: #eef4ff;
}
.player-card.current {
  border-color: #ffb300;
  box-shadow: 0 0 0 3px rgba(255, 179, 0, 0.35);
}
.player-card.dead {
  opacity: 0.5;
  filter: grayscale(0.6);
}
.player-card.offline {
  border-style: dashed;
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.player-name {
  font-weight: 700;
  font-size: 16px;
  color: #222;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}
.you-badge {
  font-size: 11px;
  background: #82b1ff;
  color: #fff;
  border-radius: 6px;
  padding: 1px 6px;
}
.offline-badge {
  color: #e67e22;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.turn-badge {
  font-size: 11px;
  background: #ffb300;
  color: #3a2b00;
  border-radius: 6px;
  padding: 1px 6px;
  font-weight: 700;
}
.dead-badge {
  font-size: 11px;
  background: #c0392b;
  color: #fff;
  border-radius: 6px;
  padding: 1px 6px;
}
.vote-count {
  font-size: 12px;
  background: #e74c3c;
  color: #fff;
  border-radius: 10px;
  padding: 1px 8px;
  font-weight: 700;
}

.char-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.char-row {
  display: grid;
  grid-template-columns: 84px 1fr 22px;
  align-items: start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #ececf0;
  font-size: 13px;
  min-height: 34px;
}
.char-row.revealed {
  background: #e3f3e6;
}
.char-row.clickable {
  cursor: pointer;
  background: #fff4d6;
  outline: 1px dashed #e0a800;
}
.char-row.clickable:hover {
  background: #ffe9a8;
}
.char-row.locked {
  opacity: 0.85;
}
.char-type {
  color: #666;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding-top: 2px;
}
.char-value {
  color: #1a1a1a;
  font-weight: 600;
  overflow-wrap: break-word;
  word-break: normal;
  hyphens: auto;
  line-height: 1.3;
}
.hidden-dot {
  letter-spacing: 3px;
  color: #999;
}
.char-hint {
  cursor: help;
  color: #2980b9;
  justify-self: center;
  padding-top: 1px;
}
.reveal-cue {
  font-size: 14px;
  color: #b8860b;
  font-weight: 700;
  white-space: nowrap;
  justify-self: center;
  padding-top: 1px;
}

.card-foot {
  margin-top: 2px;
}
.vote-button {
  width: 100%;
  font-size: 14px;
  padding: 8px;
  background: #f0c987;
  color: #333;
  border: none;
  border-radius: 8px;
}
.vote-button.voted {
  background: #2ecc71;
  color: #fff;
}
.voted-mark {
  display: inline-block;
  font-size: 12px;
  color: #27ae60;
}

@media (max-width: 480px) {
  .players-grid {
    grid-template-columns: 1fr;
  }
  .char-row {
    grid-template-columns: 72px 1fr 22px;
  }
}
</style>

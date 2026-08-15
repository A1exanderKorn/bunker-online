<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import InlineConfirm from '@/components/InlineConfirm.vue'
import { BIOLOGY_CATEGORY, fallbackCharLayout, type Biology, type CharSlot, type PublicPlayer } from '@shared/types'

/**
 * Игровое поле в виде адаптивной сетки карточек игроков.
 * Каждая карточка показывает вскрытые характеристики; свою карточку игрок
 * может раскрывать по одной характеристике — но только в свой ход.
 */
const game = useGameStore()
const { publicPlayers, myId, isVoting, amAlive, voteTally, votedIds, votesByTarget, myVote, turn, settings, charLayout, revoteFrom, lastResult, stage } =
  storeToRefs(game)

function isVoterTurn(p: PublicPlayer): boolean {
  return turn.value.currentVoterId === p.id
}

/** Имена тех, кто отдал голос за игрока p (II.4). */
function votersFor(p: PublicPlayer): string[] {
  const ids = votesByTarget.value[p.id] ?? []
  return ids.map((id) => publicPlayers.value.find((x) => x.id === id)?.name ?? '?')
}

const rows = computed<CharSlot[]>(() =>
  charLayout.value.length > 0 ? charLayout.value : fallbackCharLayout(settings.value),
)

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

function findSlotChar(p: PublicPlayer, slot: CharSlot) {
  const source = isMe(p) ? game.myCharacteristics : p.characteristics
  return source.find((c) => c.type === slot.type && (c.occ ?? 0) === slot.occ)
}

/** Значение ячейки: свою строку показываем полностью, чужую — только вскрытое. */
function getValue(p: PublicPlayer, slot: CharSlot): string | null {
  if (slot.type === BIOLOGY_CATEGORY) {
    return formatBiology(isMe(p) ? game.myBiology : p.biology)
  }
  return findSlotChar(p, slot)?.value ?? null
}

function getHint(p: PublicPlayer, slot: CharSlot): string | null {
  if (slot.type === BIOLOGY_CATEGORY) {
    return (isMe(p) ? game.myBiology?.hint : p.biology?.hint) ?? null
  }
  return findSlotChar(p, slot)?.hint ?? null
}

function isRevealed(p: PublicPlayer, slot: CharSlot): boolean {
  if (slot.type === BIOLOGY_CATEGORY) {
    return isMe(p) ? !!game.myBiology?.isVisible : !!p.biology
  }
  if (isMe(p)) {
    return !!findSlotChar(p, slot)?.isVisible
  }
  return !!findSlotChar(p, slot)
}

/** Можно ли вскрыть эту характеристику: моя, ещё не вскрыта, мой ход, лимит не исчерпан. */
function canReveal(p: PublicPlayer, slot: CharSlot): boolean {
  return (
    isMe(p) &&
    !isRevealed(p, slot) &&
    game.isMyTurn &&
    game.revealsLeftThisTurn > 0
  )
}

const pendingReveal = ref<string | null>(null)
function revealKey(p: PublicPlayer, slot: CharSlot): string {
  return `${p.id}:${slot.type}#${slot.occ}`
}
function tryReveal(p: PublicPlayer, slot: CharSlot) {
  if (!canReveal(p, slot)) return
  pendingReveal.value = revealKey(p, slot)
}
function confirmReveal(p: PublicPlayer, slot: CharSlot) {
  if (pendingReveal.value !== revealKey(p, slot) || !canReveal(p, slot)) return
  pendingReveal.value = null
  game.reveal(slot.type as never, slot.occ)
}

function voteOptionCount(): number {
  const tied =
    stage.value === 'vote2' && lastResult.value?.tie ? lastResult.value.tiedIds : null
  return publicPlayers.value.filter(
    (x) => x.isAlive && x.id !== myId.value && (!tied || tied.includes(x.id)),
  ).length
}

function isRevoteLocked(p: PublicPlayer): boolean {
  const prev = revoteFrom.value[myId.value]
  return !!prev && prev === p.id && voteOptionCount() > 1
}

function canVoteFor(p: PublicPlayer): boolean {
  if (!isVoting.value || !amAlive.value || !p.isAlive || isMe(p)) return false
  if (settings.value.voteMode === 'sequential' && !game.isMyVoteTurn) return false
  if (isRevoteLocked(p)) return false
  return true
}
function hasVoted(p: PublicPlayer): boolean {
  return votedIds.value.includes(p.id)
}

const displayPlayers = computed(() => publicPlayers.value)

// II.4: на телефоне — тап по счётчику голосов показывает, кто проголосовал.
const openVoters = ref<string | null>(null)
function toggleVoters(id: string) {
  openVoters.value = openVoters.value === id ? null : id
}
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
        current: isCurrent(p) || isVoterTurn(p),
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
          <span v-else-if="isVoterTurn(p)" class="turn-badge">🗳 голосует</span>
          <span v-if="!p.isAlive" class="dead-badge">исключён</span>
          <span
            v-if="voteTally[p.id]"
            class="vote-count"
            :title="'Голосовали: ' + votersFor(p).join(', ')"
            @click="toggleVoters(p.id)"
            >{{ voteTally[p.id] }} 🗳</span
          >
        </div>
      </header>

      <div v-if="openVoters === p.id && voteTally[p.id]" class="voters-pop">
        Голосовали: {{ votersFor(p).join(', ') }}
      </div>

      <ul class="char-list">
        <li
          v-for="slot in rows"
          :key="slot.type + '#' + slot.occ"
          class="char-row"
          :class="{
            revealed: isRevealed(p, slot),
            'mine-revealed': isMe(p) && isRevealed(p, slot),
            clickable: canReveal(p, slot),
            locked: isMe(p) && !isRevealed(p, slot) && !canReveal(p, slot),
            confirming: pendingReveal === revealKey(p, slot),
          }"
          @click="tryReveal(p, slot)"
        >
          <span class="char-type">
            {{ slot.label }}
            <span v-if="isMe(p) && isRevealed(p, slot)" class="revealed-tick" title="Вы вскрыли эту характеристику">✓</span>
          </span>
          <span class="char-value">
            <template v-if="isRevealed(p, slot) || isMe(p)">
              {{ getValue(p, slot) ?? '—' }}
            </template>
            <template v-else>
              <span class="hidden-dot">••••</span>
            </template>
          </span>
          <InlineConfirm
            v-if="pendingReveal === revealKey(p, slot)"
            @confirm="confirmReveal(p, slot)"
            @cancel="pendingReveal = null"
          />
          <span
            v-else-if="getHint(p, slot) && (isRevealed(p, slot) || isMe(p))"
            class="char-hint"
            tabindex="0"
            @click.stop
          >
            ⓘ
            <span class="hint-popup" role="tooltip">{{ getHint(p, slot) }}</span>
          </span>
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
        <span v-else-if="isRevoteLocked(p)" class="voted-mark">уже выбирали</span>
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
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-sm);
  transition: border-color var(--dur), box-shadow var(--dur), transform var(--dur-fast);
}
.player-card.self {
  border-color: var(--card-self-border);
  background: var(--card-self);
}
.player-card.current {
  border-color: var(--warn);
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
  color: var(--text);
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
  cursor: pointer;
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
  grid-template-columns: 92px 1fr 22px;
  align-items: start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
  font-size: 13px;
  min-height: 34px;
}
.char-row.confirming {
  grid-template-columns: 92px 1fr auto;
}
.char-row.revealed {
  background: color-mix(in srgb, var(--success) 16%, var(--surface));
}
.char-row.mine-revealed {
  background: color-mix(in srgb, var(--success) 24%, var(--surface));
  border-left: 3px solid var(--success);
  padding-left: 5px;
}
.revealed-tick {
  color: #2e9e4f;
  font-weight: 800;
  margin-left: 3px;
}
.voters-pop {
  background: var(--surface-3);
  color: var(--text);
  font-size: 12px;
  border-radius: 8px;
  padding: 5px 10px;
  margin: 2px 0;
}
.char-row.clickable {
  cursor: pointer;
  background: color-mix(in srgb, var(--warn) 20%, var(--surface));
  outline: 1px dashed var(--warn);
}
.char-row.clickable:hover {
  background: color-mix(in srgb, var(--warn) 34%, var(--surface));
}
.char-row.locked {
  opacity: 0.85;
}
.char-type {
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding-top: 2px;
}
.char-value {
  color: var(--text);
  font-weight: 600;
  overflow-wrap: break-word;
  word-break: normal;
  hyphens: auto;
  line-height: 1.3;
}
.hidden-dot {
  letter-spacing: 3px;
  color: var(--text-faint);
}
.char-hint {
  position: relative;
  display: inline-flex;
  cursor: help;
  color: #2980b9;
  justify-self: center;
  padding-top: 1px;
  outline: none;
}
.hint-popup {
  position: absolute;
  right: -8px;
  bottom: calc(100% + 8px);
  z-index: 20;
  width: max-content;
  max-width: min(280px, 75vw);
  padding: 8px 11px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-md);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  text-align: left;
  overflow-wrap: anywhere;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(3px);
  transition:
    opacity var(--dur-fast),
    transform var(--dur-fast);
}
.hint-popup::after {
  content: '';
  position: absolute;
  top: 100%;
  right: 10px;
  border: 6px solid transparent;
  border-top-color: var(--surface);
}
.char-hint:hover .hint-popup,
.char-hint:focus-visible .hint-popup,
.char-hint:focus .hint-popup {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
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
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: filter var(--dur-fast);
}
.vote-button:hover {
  filter: brightness(1.06);
}
.vote-button.voted {
  background: var(--success);
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
  .char-row.confirming {
    grid-template-columns: 72px 1fr auto;
  }
}
</style>

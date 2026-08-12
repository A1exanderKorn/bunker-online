<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { BIOLOGY_CATEGORY, type Biology, type PublicPlayer } from '@shared/types'

const game = useGameStore()
const { publicPlayers, myId, isVoting, amAlive, voteTally, myVote } = storeToRefs(game)

// Порядок колонок (биология вставлена между «Здоровье» и «Хобби»).
const columns = computed<string[]>(() => [
  'Профессия',
  'Здоровье',
  BIOLOGY_CATEGORY,
  'Хобби',
  'Багаж',
  'Факт',
])

function isMe(p: PublicPlayer) {
  return p.id === myId.value
}

function formatBiology(bio: Biology | null | undefined): string | null {
  if (!bio) return null
  return `${bio.sex}, ${bio.age}` + (bio.infertile ? ', Бесплоден' : '')
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

/** Вскрыта ли характеристика (для чужих — есть ли она в публичных данных). */
function isRevealed(p: PublicPlayer, type: string): boolean {
  if (type === BIOLOGY_CATEGORY) {
    return isMe(p) ? !!game.myBiology?.isVisible : !!p.biology
  }
  if (isMe(p)) {
    return !!game.myCharacteristics.find((c) => c.type === type)?.isVisible
  }
  return !!p.characteristics.find((c) => c.type === type)
}

function canReveal(p: PublicPlayer, type: string): boolean {
  return isMe(p) && !isRevealed(p, type)
}

function tryReveal(p: PublicPlayer, type: string) {
  if (!canReveal(p, type)) return
  if (!window.confirm(`Точно хотите открыть характеристику «${type}»?`)) return
  game.reveal(type as never)
}

function canVoteFor(p: PublicPlayer): boolean {
  return isVoting.value && amAlive.value && p.isAlive && !isMe(p)
}
</script>

<template>
  <table class="game-table">
    <thead>
      <tr>
        <th>Игрок</th>
        <th v-for="type in columns" :key="type">
          {{ type === BIOLOGY_CATEGORY ? 'Биология' : type }}
        </th>
        <th v-if="isVoting">Голос</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in publicPlayers" :key="p.id" :class="{ self: isMe(p), dead: !p.isAlive }">
        <td class="name-cell">
          {{ p.name }}
          <span v-if="!p.isAlive" class="dead-mark">✖</span>
          <span v-if="voteTally[p.id]" class="vote-count">{{ voteTally[p.id] }}</span>
        </td>

        <td
          v-for="type in columns"
          :key="type"
          class="cell"
          :class="{ clickable: canReveal(p, type), opened: isRevealed(p, type) }"
          @click="tryReveal(p, type)"
        >
          <span>{{ getValue(p, type) ?? '—' }}</span>
          <div v-if="getHint(p, type)" class="tooltip">{{ getHint(p, type) }}</div>
        </td>

        <td v-if="isVoting" class="vote-cell">
          <button
            v-if="canVoteFor(p)"
            class="vote-button"
            :class="{ voted: myVote === p.id }"
            @click="game.vote(p.id)"
          >
            {{ myVote === p.id ? '✓' : 'Голос' }}
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.game-table {
  width: 100%;
  border-collapse: collapse;
  background: #efefef;
}
.game-table th,
.game-table td {
  border: 1px solid #ccc;
  padding: 8px;
  position: relative;
  text-align: center;
}
.name-cell {
  font-weight: bold;
}
.cell.clickable {
  cursor: pointer;
  user-select: none;
  background: #fff7e6;
}
tr.self td {
  font-weight: bold;
}
tr.self td.opened {
  color: #2e7d32;
}
tr.dead {
  opacity: 0.45;
  text-decoration: line-through;
}
.dead-mark {
  color: #c00;
  margin-left: 4px;
}
.vote-count {
  display: inline-block;
  margin-left: 6px;
  background: #e74c3c;
  color: #fff;
  border-radius: 10px;
  padding: 0 7px;
  font-size: 13px;
}
.vote-button {
  font-size: 15px;
  padding: 4px 10px;
  background: #f0c987;
}
.vote-button.voted {
  background: #2ecc71;
  color: #fff;
}
.tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 4px;
  background: black;
  color: white;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  display: none;
  z-index: 10;
}
.cell:hover .tooltip {
  display: block;
}
</style>

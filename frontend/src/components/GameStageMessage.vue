<template>
  <div class="game-stage-message" :class="{ 'my-turn': highlightMine }">
    <div class="stage-row">
      <span class="stage-label">{{ label }}</span>
      <span v-if="isPaused" class="stage-paused">⏸ Пауза</span>
      <span v-else-if="timer != null && timer > 0" class="stage-timer">{{ timer }} сек</span>
      <span v-else-if="timer != null" class="time-expired-message">ВРЕМЯ ВЫШЛО</span>
    </div>

    <div v-if="turnLine" class="turn-line">{{ turnLine }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { STAGE_LABELS, type GameStage } from '@shared/types'
import { useGameStore } from '@/stores/game'

const props = defineProps<{
  stage: GameStage
  timer?: number | null
  isPaused?: boolean
}>()

const game = useGameStore()
const { currentPlayerName, currentVoterName, isMyTurn, isMyVoteTurn, revealsLeftThisTurn, settings } =
  storeToRefs(game)

const label = computed(() => STAGE_LABELS[props.stage])
const isVoting = computed(() => props.stage === 'vote1' || props.stage === 'vote2')
const highlightMine = computed(
  () => (props.stage === 'reveal' && isMyTurn.value) || isMyVoteTurn.value,
)

const turnLine = computed(() => {
  if (props.stage === 'reveal') {
    if (isMyTurn.value) {
      return `Ваш ход! Осталось вскрыть: ${revealsLeftThisTurn.value}. Можно завершить ход раньше.`
    }
    return currentPlayerName.value ? `Сейчас ходит: ${currentPlayerName.value}` : ''
  }
  if (isVoting.value && settings.value.voteMode === 'sequential') {
    if (isMyVoteTurn.value) return 'Ваша очередь голосовать! Обоснуйте и выберите цель.'
    return currentVoterName.value ? `Голосует: ${currentVoterName.value}` : ''
  }
  return ''
})
</script>

<style scoped>
.game-stage-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin-bottom: 12px;
  text-align: center;
  box-shadow: var(--shadow-sm);
}
.game-stage-message.my-turn {
  border-color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  box-shadow: 0 0 0 3px rgba(255, 179, 0, 0.25);
}
.stage-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.stage-label {
  color: var(--text);
  font-size: 20px;
  font-weight: bold;
}
.stage-timer {
  font-size: 18px;
  font-weight: bold;
  color: #e74c3c;
}
.stage-paused {
  font-size: 18px;
  color: var(--text-muted);
}
.time-expired-message {
  font-size: 20px;
  font-weight: bold;
  color: #ff0000;
  animation: pulse 1s infinite;
}
.turn-line {
  font-size: 15px;
  color: var(--text-muted);
  font-weight: 600;
}
.my-turn .turn-line {
  color: var(--accent-strong);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
</style>

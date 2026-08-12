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
const { currentPlayerName, isMyTurn, revealsLeftThisTurn } = storeToRefs(game)

const label = computed(() => STAGE_LABELS[props.stage])
const highlightMine = computed(() => props.stage === 'reveal' && isMyTurn.value)

const turnLine = computed(() => {
  if (props.stage !== 'reveal') return ''
  if (isMyTurn.value) {
    return `Ваш ход! Осталось вскрыть: ${revealsLeftThisTurn.value}. Можно завершить ход раньше.`
  }
  return currentPlayerName.value ? `Сейчас ходит: ${currentPlayerName.value}` : ''
})
</script>

<style scoped>
.game-stage-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background-color: #f8f8f8;
  border: 2px solid #ddd;
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 12px;
  text-align: center;
}
.game-stage-message.my-turn {
  border-color: #ffb300;
  background: #fff8e6;
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
  color: #333;
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
  color: #555;
}
.time-expired-message {
  font-size: 20px;
  font-weight: bold;
  color: #ff0000;
  animation: pulse 1s infinite;
}
.turn-line {
  font-size: 15px;
  color: #444;
  font-weight: 600;
}
.my-turn .turn-line {
  color: #a86b00;
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

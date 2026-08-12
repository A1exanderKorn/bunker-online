<template>
  <div class="game-stage-message">
    <span class="stage-label">{{ label }}</span>
    <span v-if="isPaused" class="stage-paused">⏸ Пауза</span>
    <span v-else-if="timer != null && timer > 0" class="stage-timer">{{ timer }} сек</span>
    <span v-else-if="timer != null" class="time-expired-message">ВРЕМЯ ВЫШЛО</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { STAGE_LABELS, type GameStage } from '@shared/types'

const props = defineProps<{
  stage: GameStage
  timer?: number | null
  isPaused?: boolean
}>()

const label = computed(() => STAGE_LABELS[props.stage])
</script>

<style scoped>
.game-stage-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: #f8f8f8;
  border: 2px solid #ddd;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
  text-align: center;
  font-size: 20px;
  font-weight: bold;
}

.stage-label {
  color: #333;
  margin-bottom: 4px;
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
  font-size: 24px;
  font-weight: bold;
  color: #ff0000;
  animation: pulse 1s infinite;
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

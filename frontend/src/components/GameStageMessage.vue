<template>
  <div class="game-stage-message" v-if="stage">
    <span class="stage-label">{{ props.stage }}</span>
    <span v-if="timer !== null" class="stage-timer">{{ timer }} сек</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  stage: string | null
  timer?: number | null
}>()

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

.stage-description {
  font-size: 16px;
  font-weight: normal;
  color: #555;
  margin-bottom: 4px;
}

.stage-timer {
  font-size: 18px;
  font-weight: bold;
  color: #e74c3c;
}
</style>
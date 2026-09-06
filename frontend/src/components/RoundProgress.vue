<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { cumulativeReveals, remainingPlayers } from '@shared/types'

const game = useGameStore()
const { settings, turn, roster } = storeToRefs(game)

const cumulative = computed(() => cumulativeReveals(settings.value.roundSteps))
const remaining = computed(() => remainingPlayers(settings.value.roundSteps, roster.value.length))
</script>

<template>
  <section v-if="settings.roundSteps.length" class="round-progress" aria-label="Ход раундов">
    <div class="round-progress__title">Ход раундов</div>
    <div class="round-progress__scroll">
      <article
        v-for="(step, index) in settings.roundSteps"
        :key="index"
        class="round-step"
        :class="{
          past: index < turn.stepIndex,
          current: index === turn.stepIndex,
          future: index > turn.stepIndex,
        }"
      >
        <span class="round-step__number">{{ index + 1 }}</span>
        <span class="round-step__icon" aria-hidden="true">
          {{ step.kind === 'reveal' ? '🌍' : '💀' }}
        </span>
        <span class="round-step__kind">
          {{ step.kind === 'reveal' ? 'Вскрытие' : 'Голосование' }}
        </span>
        <span class="round-step__details">
          <template v-if="step.kind === 'reveal'">Вскрыто: {{ cumulative[index] }}</template>
          <template v-else>Останется: {{ remaining[index] }}</template>
          <b v-if="step.revealThreat" title="В начале шага появится угроза">⚠</b>
        </span>
      </article>
    </div>
  </section>
</template>

<style scoped>
.round-progress {
  margin: 0 0 14px;
}
.round-progress__title {
  margin-bottom: 7px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 700;
}
.round-progress__scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 2px 8px;
}
.round-step {
  position: relative;
  display: grid;
  flex: 0 0 150px;
  grid-template-columns: 20px 22px minmax(0, 1fr);
  align-items: center;
  gap: 1px 5px;
  min-height: 57px;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  transition: opacity var(--dur-fast), border-color var(--dur-fast), transform var(--dur-fast);
}
.round-step.current {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--text);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
  transform: translateY(-1px);
}
.round-step.past {
  opacity: 0.38;
  filter: grayscale(0.8);
}
.round-step.future {
  opacity: 0.72;
}
.round-step__number {
  grid-row: 1 / span 2;
  align-self: center;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 800;
}
.round-step__icon {
  grid-row: 1 / span 2;
  align-self: center;
  font-size: 15px;
  line-height: 1;
  text-align: center;
}
.round-step__kind {
  grid-column: 3;
  font-size: 13px;
  font-weight: 800;
}
.round-step__details {
  display: flex;
  grid-column: 3;
  gap: 5px;
  align-items: center;
  font-size: 11px;
  white-space: nowrap;
}
.round-step__details b {
  color: var(--warn);
}
</style>

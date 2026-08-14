<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { STAGE_LABELS } from '@shared/types'

/**
 * Информационное окно: катастрофа, срок в бункере, доп. условия,
 * угрозы и текущее состояние игры.
 */
const game = useGameStore()
const { publicPlayers, roster, settings, stage, turn, bunker } = storeToRefs(game)

const source = computed(() => (publicPlayers.value.length > 0 ? publicPlayers.value : roster.value))
const aliveCount = computed(() => source.value.filter((p) => p.isAlive).length)
const startCount = computed(() => source.value.length)
const survivorsTarget = computed(() =>
  settings.value.survivorsCount > 0 ? settings.value.survivorsCount : Math.ceil(startCount.value / 2),
)
const stageLabel = computed(() => STAGE_LABELS[stage.value])
const conditions = computed(() => bunker.value.conditions ?? [])
</script>

<template>
  <section class="bunker-info fade-in">
    <div class="card info-block conditions" v-if="conditions.length">
      <h4>📜 Доп. условия</h4>
      <ul>
        <li v-for="(c, i) in conditions" :key="i" class="condition-item">
          <div class="cond-by">Добавил: <b>{{ c.byName }}</b></div>
          <div class="cond-text">{{ c.text }}</div>
        </li>
      </ul>
    </div>

    <div class="card info-block catastrophe">
      <h4>☢️ Катастрофа</h4>
      <p class="cat-text">{{ bunker.catastrophe || '—' }}</p>
      <div class="years">🏠 Пребывание в бункере: <b>{{ bunker.years }}</b> {{ bunker.years === 1 ? 'год' : bunker.years < 5 ? 'года' : 'лет' }}</div>
    </div>

    <div class="card info-block state">
      <h4>📊 Состояние игры</h4>
      <ul>
        <li>Стадия: <b>{{ stageLabel }}</b></li>
        <li>В игре: <b>{{ aliveCount }}</b> из {{ startCount }}</li>
        <li>Проходят в бункер: <b>{{ survivorsTarget }}</b></li>
        <li v-if="turn.round > 0">Раунд вскрытия: <b>{{ turn.round }}</b></li>
      </ul>
    </div>

    <div class="card info-block threats" v-if="settings.threatsEnabled">
      <h4>⚠️ Угрозы</h4>
      <TransitionGroup name="list" tag="ul" v-if="bunker.threats.length">
        <li v-for="(t, i) in bunker.threats" :key="i" class="threat-item">{{ t }}</li>
      </TransitionGroup>
      <p v-else class="no-threats">Пока угроз нет.</p>
    </div>
  </section>
</template>

<style scoped>
.bunker-info {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  grid-template-areas: 'conditions conditions' 'cat state' 'threats threats';
  gap: 12px;
  width: 100%;
}
.info-block {
  padding: 14px 16px;
  color: var(--text);
}
.conditions {
  grid-area: conditions;
}
.catastrophe {
  grid-area: cat;
}
.state {
  grid-area: state;
}
.threats {
  grid-area: threats;
}
.info-block h4 {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--info);
}
.cat-text {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}
.years {
  font-size: 13px;
}
.years b,
.info-block b {
  color: var(--accent);
}
.info-block ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
}
.conditions ul,
.threats ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.condition-item {
  background: color-mix(in srgb, var(--info) 12%, var(--surface));
  border-left: 3px solid var(--info);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.4;
}
.cond-by {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.cond-text {
  color: var(--text);
}
.threat-item {
  background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  border-left: 3px solid var(--warn);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 1.4;
}
.no-threats {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint);
}
@media (max-width: 640px) {
  .bunker-info {
    grid-template-columns: 1fr;
    grid-template-areas: 'conditions' 'cat' 'state' 'threats';
  }
}
</style>

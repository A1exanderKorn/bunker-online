<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { STAGE_LABELS } from '@shared/types'

/**
 * Информационное окно: начальные условия бункера и текущее состояние игры.
 * Начальные условия сейчас статичны (флейвор); позже станут настройкой лобби.
 */
const game = useGameStore()
const { roster, publicPlayers, settings, stage, turn } = storeToRefs(game)

// В игре опираемся на publicPlayers (всегда приходит с gameStarted),
// до игры — на roster.
const source = computed(() =>
  publicPlayers.value.length > 0 ? publicPlayers.value : roster.value,
)
const aliveCount = computed(() => source.value.filter((p) => p.isAlive).length)
const startCount = computed(() => source.value.length)
const survivorsTarget = computed(() =>
  settings.value.survivorsCount > 0
    ? settings.value.survivorsCount
    : Math.ceil(startCount.value / 2),
)
const stageLabel = computed(() => STAGE_LABELS[stage.value])
</script>

<template>
  <section class="bunker-info">
    <div class="info-block conditions">
      <h4>🏠 Условия бункера</h4>
      <ul>
        <li>Вместимость: <b>{{ survivorsTarget }}</b> чел.</li>
        <li>Снаружи: заражённая пустошь, выживание невозможно.</li>
        <li>Запасов еды и воды: на <b>1 год</b>.</li>
        <li>Цель: отобрать наиболее полезный состав для выживания вида.</li>
      </ul>
    </div>

    <div class="info-block state">
      <h4>📊 Состояние игры</h4>
      <ul>
        <li>Стадия: <b>{{ stageLabel }}</b></li>
        <li>В игре: <b>{{ aliveCount }}</b> из {{ startCount }}</li>
        <li>Проходят в бункер: <b>{{ survivorsTarget }}</b></li>
        <li v-if="turn.round > 0">Раунд вскрытия: <b>{{ turn.round }}</b></li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.bunker-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
}
.info-block {
  background: #23232b;
  border: 1px solid #37373f;
  border-radius: 12px;
  padding: 14px 16px;
  color: #ddd;
}
.info-block h4 {
  margin: 0 0 8px;
  font-size: 15px;
  color: #82eaff;
}
.info-block ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.5;
}
.info-block b {
  color: #ffd479;
}
@media (max-width: 640px) {
  .bunker-info {
    grid-template-columns: 1fr;
  }
}
</style>

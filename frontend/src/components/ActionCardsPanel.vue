<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'

/**
 * Заглушка панели карт действия. Функционал появится позже,
 * когда карты будут описаны в Excel. Пока — визуальный плейсхолдер.
 */
const game = useGameStore()
const { actionCards } = storeToRefs(game)
</script>

<template>
  <section class="card action-cards fade-in">
    <header class="ac-head">
      <h4>🃏 Карты действия</h4>
      <span class="soon">скоро</span>
    </header>

    <div v-if="actionCards.length === 0" class="ac-empty">
      <div class="ac-placeholder" v-for="n in 3" :key="n">
        <div class="ac-face">?</div>
        <div class="ac-caption">Карта действия</div>
      </div>
    </div>

    <div v-else class="ac-list">
      <div v-for="c in actionCards" :key="c.id" class="ac-item" :class="{ used: c.used }">
        <div class="ac-title">{{ c.title }}</div>
        <div class="ac-desc">{{ c.description }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.action-cards {
  padding: 14px 16px;
  width: 100%;
}
.ac-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ac-head h4 {
  margin: 0;
  font-size: 15px;
  color: var(--accent);
}
.soon {
  font-size: 11px;
  color: var(--text-faint);
  border: 1px dashed var(--border-strong);
  border-radius: 6px;
  padding: 1px 6px;
}
.ac-empty {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.ac-placeholder {
  flex: 1 1 90px;
  min-width: 80px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  padding: 12px;
  text-align: center;
  opacity: 0.6;
  transition: transform var(--dur-fast), opacity var(--dur-fast);
}
.ac-placeholder:hover {
  transform: translateY(-2px);
  opacity: 0.85;
}
.ac-face {
  font-size: 28px;
  color: var(--text-faint);
}
.ac-caption {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 4px;
}
</style>

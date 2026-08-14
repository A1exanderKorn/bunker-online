<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import type { ActionCard } from '@shared/types'
import CardPlayModal from '@/components/CardPlayModal.vue'

/**
 * Панель карт действия игрока. Клик по карте → подтверждение → выбор целей
 * (если нужны) в модалке → отправка на сервер.
 */
const game = useGameStore()
const { myCards, settings, started } = storeToRefs(game)

const activeCard = ref<ActionCard | null>(null)

function canPlay(c: ActionCard): boolean {
  if (c.used) return false
  if (c.stage === 'any') return true
  if (c.stage === 'reveal') return game.stage === 'reveal'
  return game.stage === 'vote1' || game.stage === 'vote2'
}

function stageLabel(c: ActionCard): string {
  return c.stage === 'any' ? 'в любой момент' : c.stage === 'reveal' ? 'на вскрытии' : 'на голосовании'
}

function onClickCard(c: ActionCard) {
  if (!canPlay(c)) return
  if (c.pickSpecs.length === 0) {
    if (!window.confirm(`Сыграть карту «${c.title}»?`)) return
    game.playCard(c.instanceId, {})
    return
  }
  activeCard.value = c
}
</script>

<template>
  <section v-if="started && settings.actionCardsEnabled" class="card action-cards fade-in">
    <header class="ac-head">
      <h4>🃏 Ваши карты действия</h4>
    </header>

    <div v-if="myCards.length === 0" class="ac-empty-msg">Карт нет.</div>

    <div v-else class="ac-list">
      <button
        v-for="c in myCards"
        :key="c.instanceId"
        class="ac-item"
        :class="{ used: c.used, playable: canPlay(c) }"
        :disabled="c.used"
        @click="onClickCard(c)"
      >
        <div class="ac-cat">Категория {{ c.category }}</div>
        <div class="ac-title">{{ c.title }}</div>
        <div class="ac-foot">
          <span class="ac-stage">{{ stageLabel(c) }}</span>
          <span v-if="c.used" class="ac-used">использована</span>
          <span v-else-if="canPlay(c)" class="ac-play">играть →</span>
          <span v-else class="ac-wait">ждёт этапа</span>
        </div>
      </button>
    </div>

    <CardPlayModal
      v-if="activeCard"
      :card="activeCard"
      @close="activeCard = null"
      @confirm="(targets) => { game.playCard(activeCard!.instanceId, targets); activeCard = null }"
    />
  </section>
</template>

<style scoped>
.action-cards {
  padding: 14px 16px;
  width: 100%;
}
.ac-head h4 {
  margin: 0 0 10px;
  font-size: 15px;
  color: var(--accent);
}
.ac-empty-msg {
  color: var(--text-faint);
  font-size: 13px;
}
.ac-list {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.ac-item {
  flex: 1 1 200px;
  max-width: 280px;
  text-align: left;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  cursor: default;
  color: var(--text);
  transition: transform var(--dur-fast), box-shadow var(--dur-fast), border-color var(--dur-fast);
}
.ac-item.playable {
  cursor: pointer;
  border-color: var(--accent);
}
.ac-item.playable:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}
.ac-item.used {
  opacity: 0.5;
  filter: grayscale(0.5);
}
.ac-cat {
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.ac-title {
  font-size: 14px;
  font-weight: 600;
  margin: 6px 0 10px;
  line-height: 1.35;
}
.ac-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.ac-stage {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-3);
  border-radius: 6px;
  padding: 1px 7px;
}
.ac-play {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.ac-wait {
  font-size: 11px;
  color: var(--text-faint);
}
.ac-used {
  font-size: 11px;
  color: var(--text-faint);
}
</style>

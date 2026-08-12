<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'

/** Всплывающее окно у всех игроков при применении карты действия. */
const game = useGameStore()
const { cardPopup } = storeToRefs(game)
</script>

<template>
  <Transition name="pop">
    <div v-if="cardPopup" class="popup-wrap" @click="game.dismissCardPopup()">
      <div class="popup card">
        <div class="pop-icon">🃏</div>
        <div class="pop-body">
          <div class="pop-by"><b>{{ cardPopup.byName }}</b> играет карту</div>
          <div class="pop-title">{{ cardPopup.title }}</div>
          <div class="pop-effect">{{ cardPopup.effectText }}</div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.popup-wrap {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 250;
  cursor: pointer;
  width: min(440px, 92vw);
}
.popup {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border: 2px solid var(--accent);
  box-shadow: var(--shadow-lg);
}
.pop-icon {
  font-size: 30px;
}
.pop-by {
  font-size: 13px;
  color: var(--text-muted);
}
.pop-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
  margin: 2px 0;
}
.pop-effect {
  font-size: 13px;
  color: var(--text);
}
.pop-enter-active,
.pop-leave-active {
  transition: all var(--dur) var(--ease);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-12px);
}
</style>

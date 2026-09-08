<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import ChallengeRequirements from '@/components/ChallengeRequirements.vue'

/** Центральный попап новой угрозы. Закрывается кликом по затемнённому фону. */
const game = useGameStore()
const { threatPopup } = storeToRefs(game)
</script>

<template>
  <Transition name="threat-pop">
    <div v-if="threatPopup" class="threat-overlay" @click.self="game.dismissThreatPopup()">
      <article class="threat-dialog card" role="dialog" aria-modal="true" aria-label="Новая угроза">
        <div class="threat-icon">⚠️</div>
        <p class="threat-kicker">Новая угроза</p>
        <h2>{{ threatPopup.flavor }}</h2>
        <ChallengeRequirements :requirements="threatPopup.requirements" />
        <p class="threat-hint">Нажмите за пределами окна, чтобы закрыть</p>
      </article>
    </div>
  </Transition>
</template>

<style scoped>
.threat-overlay {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--overlay);
  backdrop-filter: blur(4px);
  cursor: pointer;
}
.threat-dialog {
  width: min(620px, 94vw);
  padding: clamp(22px, 5vw, 38px);
  border: 2px solid var(--warn);
  box-shadow: var(--shadow-lg);
  text-align: center;
  cursor: default;
}
.threat-icon {
  font-size: 42px;
  line-height: 1;
}
.threat-kicker {
  margin: 12px 0 6px;
  color: var(--warn);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.threat-dialog h2 {
  margin: 0;
  color: var(--text);
  font-size: clamp(18px, 4vw, 25px);
  line-height: 1.45;
}
.threat-hint {
  margin: 20px 0 0;
  color: var(--text-faint);
  font-size: 12px;
}
.threat-pop-enter-active,
.threat-pop-leave-active {
  transition: opacity var(--dur) var(--ease);
}
.threat-pop-enter-active .threat-dialog,
.threat-pop-leave-active .threat-dialog {
  transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease);
}
.threat-pop-enter-from,
.threat-pop-leave-to,
.threat-pop-enter-from .threat-dialog,
.threat-pop-leave-to .threat-dialog {
  opacity: 0;
}
.threat-pop-enter-from .threat-dialog,
.threat-pop-leave-to .threat-dialog {
  transform: translateY(12px) scale(0.97);
}
</style>

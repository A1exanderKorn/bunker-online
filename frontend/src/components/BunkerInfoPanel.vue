<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import ActionCardsPanel from '@/components/ActionCardsPanel.vue'
import ChallengeRequirements from '@/components/ChallengeRequirements.vue'
import ConditionGrants from '@/components/ConditionGrants.vue'

/**
 * Информационное окно: катастрофа, срок в бункере, доп. условия,
 * угрозы и карты действия.
 */
const game = useGameStore()
const { settings, bunker } = storeToRefs(game)
const conditions = computed(() => bunker.value.conditions ?? [])
</script>

<template>
  <section class="bunker-info fade-in">
    <div class="card info-block conditions" v-if="conditions.length">
      <h4>📜 Доп. условия</h4>
      <ul>
        <li v-for="(c, i) in conditions" :key="i" class="condition-item">
          <div class="cond-by">Добавил: <b>{{ c.byName }}</b></div>
          <div class="cond-text">{{ c.flavor }}</div>
          <ConditionGrants :grants="c.grants" />
        </li>
      </ul>
    </div>

    <div class="card info-block catastrophe">
      <h4>☢️ Катастрофа</h4>
      <p class="cat-text">{{ bunker.catastrophe.flavor || '—' }}</p>
      <ChallengeRequirements v-if="bunker.catastrophe.flavor" :requirements="bunker.catastrophe.requirements" />
      <div class="years">🏠 Пребывание в бункере: <b>{{ bunker.years }}</b> {{ bunker.years === 1 ? 'год' : bunker.years < 5 ? 'года' : 'лет' }}</div>
    </div>

    <div class="card info-block threats" v-if="settings.threatsEnabled">
      <h4>⚠️ Угрозы</h4>
      <TransitionGroup name="list" tag="ul" v-if="bunker.threats.length">
        <li v-for="(t, i) in bunker.threats" :key="i" class="threat-item">
          <div class="threat-flavor">{{ t.flavor }}</div>
          <ChallengeRequirements :requirements="t.requirements" />
        </li>
      </TransitionGroup>
      <p v-else class="no-threats">Пока угроз нет.</p>
    </div>

    <ActionCardsPanel class="actions" />
  </section>
</template>

<style scoped>
.bunker-info {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  align-items: stretch;
  gap: 12px;
  width: 100%;
}
.info-block {
  padding: 14px 16px;
  color: var(--text);
}
.actions {
  min-width: 0;
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
.threat-flavor {
  font-size: 13px;
  line-height: 1.4;
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
  }
}
</style>

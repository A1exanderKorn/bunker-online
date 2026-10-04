<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'

const game = useGameStore()
const { cardHistory } = storeToRefs(game)
const chronologicalHistory = computed(() => [...cardHistory.value].sort((a, b) => a.seq - b.seq))
const open = ref<Record<number, boolean>>({})
const expanded = ref(true)

function roundLabel(round: number): string {
  return round > 0 ? `Раунд ${round}` : 'До первого раунда вскрытия'
}

function chipClass(value: string | null, isPublic: boolean | undefined): string {
  if (value == null) return 'hidden'
  return isPublic ? 'revealed' : 'privileged'
}

function chipText(value: string | null): string {
  return value ?? '••••'
}

function toggle(seq: number) {
  open.value = { ...open.value, [seq]: !open.value[seq] }
}
</script>

<template>
  <section class="card history-strip" aria-label="История карт">
    <h4>
      <button
        type="button"
        class="history-toggle"
        :aria-expanded="expanded"
        aria-controls="card-history-content"
        @click="expanded = !expanded"
      >
        <span>История карт</span>
        <span aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
      </button>
    </h4>
    <div v-show="expanded" id="card-history-content" class="history-row">
      <div v-if="!cardHistory.length" class="history-empty">Нет</div>
      <article v-for="entry in chronologicalHistory" :key="entry.seq" class="history-item">
        <div class="history-card">
          <span class="hc-round">{{ roundLabel(entry.round) }}</span>
          <span class="hc-by">{{ entry.byName }}</span>
          <span class="hc-title">«{{ entry.cardTitle }}»</span>
          <p v-if="!entry.charChanges.length" class="hc-summary">{{ entry.summary }}</p>
          <button
            v-if="entry.charChanges.length"
            type="button"
            class="hc-toggle"
            :aria-expanded="!!open[entry.seq]"
            @click="toggle(entry.seq)"
          >
            {{ open[entry.seq] ? 'Свернуть' : 'Подробнее' }}
          </button>
        </div>
        <div
          v-if="entry.charChanges.length"
          class="hc-details-clip"
          :class="{ open: open[entry.seq] }"
        >
          <div class="hc-details-inner" :aria-hidden="!open[entry.seq]">
            <ul class="hc-details">
              <li
                v-for="(change, i) in entry.charChanges"
                :key="change.playerId + change.slotType + change.slotOcc + i"
              >
                <div class="hc-line1">
                  <span v-if="change.playerName" class="hc-who">{{ change.playerName }}</span>
                  <span class="hc-slot">{{ change.slotLabel }}</span>
                </div>
                <div class="hc-line2">
                  <span class="hc-chip" :class="chipClass(change.oldValue, change.oldPublic)">
                    {{ chipText(change.oldValue) }}
                  </span>
                  <span class="hc-arrow" aria-hidden="true">➡️</span>
                  <span class="hc-chip" :class="chipClass(change.newValue, change.newPublic)">
                    {{ chipText(change.newValue) }}
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.history-strip {
  padding: 10px 12px 12px;
  min-width: 0;
}
.history-strip h4 {
  margin: 0;
  font-size: 15px;
  color: var(--info);
}
.history-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 36px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.history-empty {
  display: grid;
  place-items: center;
  min-height: 100px;
  padding: 16px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
}
.history-row {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-wrap: anywhere;
}
.history-item {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex: 0 0 auto;
  min-width: 0;
}
.history-card {
  width: 100%;
  min-height: 140px;
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 1;
}
.hc-round {
  font-size: 11px;
  color: var(--text-muted);
}
.hc-by {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.hc-title {
  font-size: 14px;
  color: var(--accent);
  font-weight: 700;
  line-height: 1.3;
}
.hc-summary {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.35;
  color: var(--text-muted);
  overflow: hidden;
}
.hc-toggle {
  margin-top: auto;
  align-self: flex-start;
  border: 1px solid var(--border-strong);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.hc-details-clip {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 240ms ease;
}
.hc-details-clip.open {
  grid-template-rows: 1fr;
}
.hc-details-inner {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.hc-details {
  list-style: none;
  margin: 0;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  align-content: flex-start;
  column-gap: 14px;
  row-gap: 8px;
  border: 1px solid var(--border-strong);
  border-top: none;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  background: var(--surface);
}
.hc-details li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
  min-width: 0;
}
.hc-line1,
.hc-line2 {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hc-who {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.hc-slot {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: var(--text-muted);
}
.hc-arrow {
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
}
.hc-chip {
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  line-height: 1.3;
  white-space: normal;
}
.hc-chip.revealed {
  background: color-mix(in srgb, var(--success) 16%, var(--surface));
  color: var(--text);
}
.hc-chip.privileged {
  background: color-mix(in srgb, var(--text-faint) 13%, var(--surface));
  border-left: 3px solid var(--text-faint);
  color: var(--text-faint);
}
.hc-chip.hidden {
  background: color-mix(in srgb, var(--text-faint) 13%, var(--surface));
  border-left: 3px solid var(--text-faint);
  letter-spacing: 3px;
  color: var(--text-faint);
}
@media (prefers-reduced-motion: reduce) {
  .hc-details-clip {
    transition: none;
  }
}
</style>

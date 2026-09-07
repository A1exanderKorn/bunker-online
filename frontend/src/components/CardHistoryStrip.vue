<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'

const game = useGameStore()
const { cardHistory } = storeToRefs(game)
const open = ref<Record<number, boolean>>({})

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
  <section v-if="cardHistory.length" class="card history-strip" aria-label="История карт">
    <h4>История карт</h4>
    <div class="history-row">
      <article v-for="entry in cardHistory" :key="entry.seq" class="history-item">
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
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--info);
}
.history-row {
  display: flex;
  flex-direction: row;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  /* Карточки 148px + место под горизонтальный ползунок, чтобы он не наезжал снизу. */
  height: 162px;
  align-items: flex-start;
}
.history-item {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 0 0 auto;
  height: 148px;
}
.history-card {
  flex: 0 0 220px;
  width: 220px;
  height: 148px;
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
  font-size: 12px;
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
  grid-template-columns: 0fr;
  transition: grid-template-columns 240ms ease;
}
.hc-details-clip.open {
  grid-template-columns: 1fr;
}
.hc-details-inner {
  min-width: 0;
  overflow: hidden;
}
.hc-details {
  list-style: none;
  margin: 0;
  box-sizing: border-box;
  width: max-content;
  height: 148px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  align-content: flex-start;
  column-gap: 14px;
  row-gap: 8px;
  border: 1px solid var(--border-strong);
  border-left: none;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--surface);
}
.hc-details li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
  width: max-content;
  max-width: none;
}
.hc-line1,
.hc-line2 {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
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
  white-space: nowrap;
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

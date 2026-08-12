<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'

/**
 * Мини-админка для тестирования карт: выдать себе любую карту из каталога.
 * Открывается кнопкой; каталог грузится по запросу.
 */
const game = useGameStore()
const { catalog, started } = storeToRefs(game)

const open = ref(false)
const filter = ref('')

function toggle() {
  open.value = !open.value
  if (open.value && catalog.value.length === 0) game.requestCatalog()
}

const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  if (!f) return catalog.value
  return catalog.value.filter(
    (c) => c.title.toLowerCase().includes(f) || c.code.toLowerCase().includes(f) || c.category.toLowerCase() === f,
  )
})
</script>

<template>
  <section v-if="started" class="admin-wrap">
    <button class="btn btn--ghost btn--sm" @click="toggle">
      🛠 Тест карт {{ open ? '▲' : '▼' }}
    </button>

    <div v-if="open" class="admin-panel card fade-in">
      <div class="admin-head">
        <input class="input" v-model="filter" placeholder="Фильтр: название / код / категория (A/B/C/D)" />
        <button class="btn btn--ghost btn--sm" @click="game.requestCatalog()">↻</button>
      </div>
      <div class="admin-list">
        <div v-for="c in filtered" :key="c.cardId" class="admin-row">
          <div class="admin-info">
            <span class="admin-cat">{{ c.category }}</span>
            <span class="admin-title">{{ c.title }}</span>
            <span class="admin-meta">{{ c.stage }} · picks {{ c.picks }} · {{ c.cardId }}</span>
          </div>
          <button class="btn btn--primary btn--sm" @click="game.adminGiveCard(c.cardId)">Выдать себе</button>
        </div>
        <p v-if="filtered.length === 0" class="admin-empty">Ничего не найдено (или каталог ещё грузится).</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-wrap {
  margin-top: 16px;
}
.admin-panel {
  margin-top: 10px;
  padding: 12px;
  max-height: 420px;
  overflow-y: auto;
}
.admin-head {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  position: sticky;
  top: 0;
  background: var(--surface);
  padding-bottom: 6px;
}
.admin-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.admin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
.admin-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.admin-cat {
  font-size: 10px;
  font-weight: 700;
  color: var(--accent);
}
.admin-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.admin-meta {
  font-size: 11px;
  color: var(--text-faint);
}
.admin-empty {
  color: var(--text-faint);
  font-size: 13px;
}
</style>

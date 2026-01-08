<script setup lang="ts">
import type { PublicPlayerData } from '@/stores/gameState'
import { usePlayerStore } from '@/stores/player';
import type { Socket } from 'socket.io-client'
import { computed } from 'vue'

const props = defineProps<{
  players: PublicPlayerData[]
  socket: Socket | null
}>()

const playerStore = usePlayerStore()

/** возвращает значение характеристики, если видна */
function getValue(p: PublicPlayerData, type: string) {
  if (type === 'Биология') {
    if(playerStore.id == p.id){
      return `${playerStore.biology?.sex}, ${playerStore.biology?.age}` + (playerStore.biology?.infertile ? ', Бесплоден' : '')
    }
    return p.biology ? (`${p.biology.sex}, ${p.biology.age}` + (p.biology.infertile ? ', Бесплоден' : '')) : null
  }
  if(playerStore.id == p.id){
    return playerStore.characteristics.find(c => c.type === type)?.value
  }
  const ch = (p.characteristics || []).find(c => c.type === type)
  return ch ? ch.value : null
}

function hasVisible(p: PublicPlayerData, type: string) {
  if (type === 'Биология') return !!p.biology
  return !!(p.characteristics || []).find(c => c.type === type)
}

function getHint(p: PublicPlayerData, type: string) {
  if (type === 'Биология') {
    return playerStore.id === p.id
      ? playerStore.biology?.hint
      : p.biology?.hint ?? null
  }
  if (playerStore.id === p.id) {
    return playerStore.characteristics.find(c => c.type === type)?.hint ?? null
  }
  return (p.characteristics || []).find(c => c.type === type)?.hint ?? null
}

/** подтверждение и отправка события на сервер */
function tryReveal(p: PublicPlayerData, type: string) {
  if (hasVisible(p, type)) {
    // уже открыто — ничего не делаем
    return
  }
  const confirmText = `Точно хотите открыть характеристику "${type}"?`
  if (!window.confirm(confirmText)) return

  // emit на сервер
  if (!props.socket) {
    console.warn('socket not connected')
    return
  }

  props.socket.emit('revealCharacteristic', {
    playerId: p.id,
    characteristicType: type
  })
}
</script>


<template>
  <table class="game-table">
    <thead>
      <tr>
        <th>Ник игрока</th>
        <th>Профессия</th>
        <th>Здоровье</th>
        <th>Биология</th>
        <th>Хобби</th>
        <th>Багаж</th>
        <th>Факт</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in players" :key="p.id" :class="p.id===playerStore.id ? 'self' : ''">
        <td>{{ p.name }}</td>

        <td
  v-for="type in ['Профессия', 'Здоровье', 'Биология', 'Хобби', 'Багаж', 'Факт']"
  :key="type"
  @click="p.id === playerStore.id ? tryReveal(p, type) : undefined"
  :class="{ clickable: p.id === playerStore.id && !hasVisible(p, type), opened: hasVisible(p, type) }"
  class="relative group"
>
  <span>
    {{ getValue(p, type) ?? '—' }}
  </span>

  <div
    v-if="getHint(p, type)"
    class="tooltip"
  >
    {{ getHint(p, type) }}
  </div>
</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.game-table {
  width: 100%;
  border-collapse: collapse;
}
.game-table th,
.game-table td {
  border: 1px solid #ddd;
  padding: 8px;
  position: relative;
}
.clickable {
  cursor: pointer;
  user-select: none;
}
tr.self td{
  font-weight: bold;
}
tr.self td.opened{
  color: greenyellow;
}

td .tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 4px;
  background: black;
  color: white;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  display: none;
  z-index: 10;
}
td:hover .tooltip {
  display: block;
}
</style>
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
      return `${playerStore.biology?.sex}, ${playerStore.biology?.age}`
    }
    return p.biology ? `${p.biology.sex}, ${p.biology.age}` : null
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

/** подтверждение и отправка события на сервер */
function tryReveal(p: PublicPlayerData, type: string) {
  if (hasVisible(p, type)) {
    // уже открыто — ничего не делаем
    return
  }
  const confirmText = `Точно хотите открыть характеристику "${type}" у игрока "${p.name}"?`
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
      <tr v-for="p in players" :key="p.id">
        <td>{{ p.name }}</td>

        <td @click="tryReveal(p, 'Профессия')" :class="{ clickable: p.id==playerStore.id&&!hasVisible(p, 'Профессия') }">
          {{ getValue(p, 'Профессия') ?? '—' }}
        </td>

        <td @click="tryReveal(p, 'Здоровье')" :class="{ clickable: p.id==playerStore.id&&!hasVisible(p, 'Здоровье') }">
          {{ getValue(p, 'Здоровье') ?? '—' }}
        </td>

        <td @click="tryReveal(p, 'Биология')" :class="{ clickable: p.id==playerStore.id&&!hasVisible(p, 'Биология') }">
          {{ getValue(p, 'Биология') ?? '—' }}
        </td>        

        <td @click="tryReveal(p, 'Хобби')" :class="{ clickable: p.id==playerStore.id&&!hasVisible(p, 'Хобби') }">
          {{ getValue(p, 'Хобби') ?? '—' }}
        </td>

        <td @click="tryReveal(p, 'Багаж')" :class="{ clickable: p.id==playerStore.id&&!hasVisible(p, 'Багаж') }">
          {{ getValue(p, 'Багаж') ?? '—' }}
        </td>

        <td @click="tryReveal(p, 'Факт')" :class="{ clickable: p.id==playerStore.id&&!hasVisible(p, 'Факт') }">
          {{ getValue(p, 'Факт') ?? '—' }}
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
}
.clickable {
  cursor: pointer;
  user-select: none;
}
</style>
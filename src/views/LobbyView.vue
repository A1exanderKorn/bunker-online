<template>
  <div class="p-4 text-center">
    <h2 class="text-xl">Код лобби: {{ store.lobbyCode }}</h2>
    <h3 class="mt-4">Игроки:</h3>
    <ul class="mt-2">
      <li v-for="player in store.players" :key="player">{{ player }}</li>
    </ul>
    <button v-if="store.isHost" @click="start" class="mt-4 px-4 py-2 bg-red-500 text-white">
      Начать игру
    </button>
  </div>
</template>

<script setup lang="ts">
import { useLobbyStore } from '@/stores/lobby'
import { startGame } from '@/services/socket'

const store = useLobbyStore()

const start = () => {
  startGame()
}
</script>

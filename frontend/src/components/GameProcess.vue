<template>
  <div class="content">
    <GameStagePanel></GameStagePanel>

    <InfoPanel></InfoPanel>

    <ul class="player-list">
      <PlayerCard
        class="player-card"
        v-for="(player, index) in players"
        :key="index"
        :player="player"
        :self-id="selfId"
      />
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useLobbyStore } from '@/stores/lobby'
import { computed, ref } from 'vue'
import GameStagePanel from '@/components/GameStagePanel.vue'
import InfoPanel from '@/components/InfoPanel.vue'
import PlayerCard from '@/components/PlayerCard.vue'
import { usePlayerStore } from '@/stores/player'

const store = useLobbyStore()
const playerStore = usePlayerStore()
const selfId = computed(() => playerStore.id)
const players = ref<string[]>(store.players)
</script>

<style lang="css" scoped>
.content {
  display: flex;
  flex-direction: column;
  width: 100%;
  align-items: center;
  justify-content: space-around;
  gap: 80px;
}

.player-list {
  display: flex;
  flex-direction: row;
  width: 100%;
  flex-wrap: wrap;
  justify-content: space-around;
}

.player-card {
  display: flex;
  flex-direction: column;
  width: 30%;
  min-width: 250px;
  background-color: rgb(176, 176, 176);
  font: rgb(53, 53, 53);
}
</style>

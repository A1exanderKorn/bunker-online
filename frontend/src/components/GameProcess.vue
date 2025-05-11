<template>
  <div class="content">
    <GameStagePanel></GameStagePanel>

    <InfoPanel></InfoPanel>

    <ul class="player-list">
      <!-- <PlayerCard class="player-card" v-for="(player, index) in players" :key="index"></PlayerCard> -->
      <PlayerCard class="player-card"></PlayerCard>
    </ul>

  </div>
</template>

<script setup lang="ts">
import { useLobbyStore } from '@/stores/lobby';
import { ref } from 'vue';

const lobby = ref(useLobbyStore())


</script>

<style lang="css" scoped>
    .content{
        display: flex;
        flex-direction: column;
        width: 100%;
        align-items: center;
        justify-content: space-around;
        gap: 80px;
    }

    .player-list{
        display: flex;
        flex-direction: row;
        width: 100%;
        flex-wrap: wrap;
        justify-content: space-around;
    }

    .player-card{
        display: flex;
        flex-direction: column;
        width: 30%;
        min-width: 250px;
        background-color: rgb(176, 176, 176);
        font: rgb(53, 53, 53)
    }
</style>
<template>
  <div class="content">
    <GameStagePanel></GameStagePanel>

    <InfoPanel></InfoPanel>

    <ul class="player-list">
      <PlayerCard class="player-card" :player="player1" :self-id="'1'" />
      <PlayerCard class="player-card" :player="player2" :self-id="'2'" />
      <PlayerCard class="player-card" :player="player3" :self-id="'2'" />
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useLobbyStore, type Player } from '@/stores/lobby'
import { computed, ref } from 'vue'
import GameStagePanel from '@/components/GameStagePanel.vue'
import InfoPanel from '@/components/InfoPanel.vue'
import PlayerCard from '@/components/PlayerCard.vue'
import { usePlayerStore } from '@/stores/player'

const player1 = {
  id: 1,
  nickname: 'Александр',
  characteristics: [
    {
      type: 'Профессия',
      value: 'Junior-аналитик',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Здоровье',
      value: 'Эпилепсия',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Хобби',
      value: 'Тамада',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Фобия',
      value: 'Аэрофобия',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Багаж',
      value: 'Газо-бензиновый генератор',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Факт',
      value: 'Владеет английским языком',
      coef: 0.5,
      isVisible: true,
    },
  ],
  biology: {
    sex: 'Ж',
    age: '39',
    experience: '10',
    coef: 0.76,
    infertile: false,
    isVisible: true,
  },
}

const player2 = {
  id: 2,
  nickname: 'Борис',
  characteristics: [
    {
      type: 'Профессия',
      value: 'Биоинженер',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Здоровье',
      value: 'Пневмония',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Хобби',
      value: 'Фокусы',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Фобия',
      value: 'Селфифобия',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Багаж',
      value: 'Швейцарский нож',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Факт',
      value: 'Врет и преувеличивает',
      coef: 0.5,
      isVisible: true,
    },
  ],
  biology: {
    sex: 'Ж',
    age: '50',
    experience: '3.5',
    coef: 0.76,
    infertile: false,
    isVisible: true,
  },
}

const player3 = {
  id: 1,
  nickname: 'Владимир',
  characteristics: [
    {
      type: 'Профессия',
      value: 'Логист',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Здоровье',
      value: 'Идеально здоров',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Хобби',
      value: 'Скайдайвинг',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Фобия',
      value: 'Эргофобия',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Багаж',
      value: 'Бутылка воды',
      coef: 0.5,
      isVisible: true,
    },
    {
      type: 'Факт',
      value: 'Душа компании',
      coef: 0.5,
      isVisible: true,
    },
  ],
  biology: {
    sex: 'М',
    age: '60',
    experience: '8',
    coef: 0.76,
    infertile: false,
    isVisible: true,
  },
}

const store = useLobbyStore()
const playerStore = usePlayerStore()
const selfId = computed(() => playerStore.id)
const players = ref<Player[]>(store.players)
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

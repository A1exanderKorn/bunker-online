<script lang="ts" setup>
import { computed, ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { io, Socket } from 'socket.io-client'
import { useLobbyStore } from '@/stores/lobby'
import LobbyButton from '@/components/LobbyButton.vue'
import GameProcess from '@/components/GameTable.vue'
import GameTable from '@/components/GameTable.vue'
import { usePlayerStore, type Biology, type Characteristic } from '@/stores/player'
import { useGameStateStore } from '@/stores/gameState'

const store = useLobbyStore()
const route = useRoute()

const code = ref<string>(store.lobbyCode)
const name = ref<string>(store.name)
const gameStarted = ref<boolean>(false)
const nameEntered = ref<boolean>(store.name ? true : false)
const players = ref<string[]>([])
const socket = ref<Socket | null>(null)
const playerStore = usePlayerStore()
const gameStateStore = useGameStateStore()

const selfId = computed(() => playerStore.id)
const isHost = ref<boolean>(false)

const connectSocket = (playerName: string, lobbyCode: string) => {
  if (socket.value) {
    socket.value.disconnect()
  }

  socket.value = io('http://localhost:3000', {
    query: {
      name: playerName,
      lobbyCode: lobbyCode,
    },
  })

  socket.value.on('connect', () => {
    console.log('Подключено к серверу')
    playerStore.setId(socket.value?.id ?? '')
  })

  socket.value.on('updatePlayers', (playerList: string[]) => {
    console.log('update players: ', playerList)
    players.value = playerList

    if (players.value.length > 0 && players.value[0] === name.value) {
      isHost.value = true
    } else {
      isHost.value = false
    }
  })

  socket.value.on('gameStarted', (payload) => {
    console.log('Игра началась!')
    gameStarted.value = true
    gameStateStore.setPlayers(payload.players)
  })

  socket.value.on('yourCharacteristics', (data: {
          characteristics: Characteristic[],
          biology: Biology
        }) => {
    playerStore.setPlayerData(data)
  })

  socket.value.on('characteristicsUpdated', (payload) => {
  console.log('Обновлены характеристики', payload)
  gameStateStore.setPlayers(payload.players)
})
}

const handleNameSubmit = () => {
  if (name.value.trim() !== '') {
    localStorage.setItem('playerName', name.value)
    nameEntered.value = true
    connectSocket(name.value, code.value)
  }
}

watchEffect(() => {
  if (route.params.code) {
    code.value = route.params.code as string

    const savedName = localStorage.getItem('playerName')
    if (savedName && !nameEntered.value) {
      name.value = savedName
      nameEntered.value = true
      connectSocket(name.value, code.value)
    }

    if (name.value && nameEntered.value && !socket.value?.connected) {
      connectSocket(name.value, code.value)
    }
  }
})

function startGame() {
  socket.value?.emit('startGame')
}
</script>

<template>
  <GameTable v-if="gameStarted" :players="gameStateStore.players" :socket="socket" />
  <div v-else class="main-block">
    <h1>Лобби: {{ code }}</h1>

    <div v-if="!nameEntered" class="buttons-set">
      <input class="name-input" v-model="name" placeholder="Введите ваше имя" />
      <LobbyButton @click="handleNameSubmit" text="Войти" custom-class="confirm-button" />
    </div>

    <div v-else class="buttons-set">
      <h2>Игроки:</h2>
      <ul class="player-list">
        <li class="player-list-item" v-for="player in players" :key="player">{{ player }}</li>
      </ul>
      <LobbyButton
        v-if="isHost"
        @click="startGame"
        customClass="confirm-button"
        text="Начать игру"
      />
    </div>
  </div>

  <!-- <GameProcess></GameProcess> -->
</template>

<style>
.name-entry {
  margin-top: 20px;
}
button {
  margin-top: 20px;
}

.main-block {
  display: flex;
  flex-direction: column;
  margin: auto;
  height: auto;
  justify-content: space-between;
  gap: 50px;
  width: 400px;
  align-items: center;
  font-size: 18px;
}

.buttons-set {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 20px;
}
.buttons-set > * {
  width: 200px;
  height: 40px;
  margin: auto;
  border-radius: 8px;
}

.player-list {
  height: fit-content;
  display: flex;
  flex-direction: column;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 40px;
}
</style>

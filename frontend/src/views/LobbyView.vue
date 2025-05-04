<script lang="ts" setup>
import { ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { io, Socket } from 'socket.io-client'
import { useLobbyStore } from '@/stores/lobby'

const store = useLobbyStore()
const route = useRoute()

const code = ref<string>(store.lobbyCode)
const name = ref<string>(store.name)
const nameEntered = ref<boolean>(store.name?true:false)
const players = ref<string[]>([])
const socket = ref<Socket | null>(null)

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
    
  })

  socket.value.on('updatePlayers', (playerList: string[]) => {
    console.log("update players: ", playerList)
    players.value = playerList

    if (players.value.length > 0 && players.value[0] === name.value) {
      isHost.value = true
    } else {
      isHost.value = false
    }
  })

  socket.value.on('gameStarted', () => {
    console.log('Игра началась!')
    // Тут будет переход на страницу игры
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

function startGame(){

}
</script>

<template>
  <div class="lobby-container">
    <h1>Лобби: {{ code }}</h1>

    <div v-if="!nameEntered" class="name-entry">
      <input v-model="name" placeholder="Введите ваше имя" />
      <button @click="handleNameSubmit">Войти</button>
    </div>

    <div v-else class="lobby-info">
      <h2>Игроки:</h2>
      <ul>
        <li v-for="player in players" :key="player">{{ player }}</li>
      </ul>

      <button v-if="isHost" @click="startGame">Начать игру</button>
    </div>
  </div>
</template>

<style scoped>
.lobby-container {
  text-align: center;
  padding: 20px;
}
.name-entry {
  margin-top: 20px;
}
.lobby-info {
  margin-top: 20px;
}
button {
  margin-top: 20px;
}
</style>
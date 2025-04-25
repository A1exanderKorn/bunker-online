<template>
  <div class="p-4 text-center">
    <h1 class="text-2xlmb-4">Добро пожаловать!</h1>
    <div v-if="!nameSet">
      <input type="text" v-model="name" placeholder="Введите имя" class="border p-2" />
      <button @click="confirmName" class="ml-2 px-4 py-2 bg-blue-500 text-white">OK</button>
    </div>

    <div v-else>
      <button @click="createLobby" class="px-4 py-2 bg-green-500 text-white mr-4">
        Создать игру
      </button>
      <button @click="joinMode = !joinMode" class="px-4 py-2 bg-yellow-400 text-white">
        Присоединиться к игре
      </button>

      <div v-if="joinMode" class="mt-4">
        <input v-model="code" placeholder="Введите код лобби" class="border p-2" />
        <button @click="joinLobby" class="ml-2 px-4 py-2 bg-blue-500 text-white">Войти</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLobbyStore } from '@/stores/lobby'
import { connectSocket } from '@/services/socket'

const name = ref('')
const code = ref('')
const joinMode = ref(false)
const nameSet = ref(false)

const store = useLobbyStore()
const router = useRouter()

const confirmName = () => {
  if (name.value.trim()) {
    store.setName(name.value)
    nameSet.value = true
  }
}

const createLobby = () => {
  const lobbyCode = Math.random().toString(36).substring(2, 6).toUpperCase()
  store.setLobby(lobbyCode, true)
  connectSocket(name.value, lobbyCode, true)
  router.push('/lobby')
}

const joinLobby = () => {
  store.setLobby(code.value.toUpperCase(), false)
  connectSocket(name.value, code.value.toUpperCase(), false)
  router.push('/lobby')
}
</script>

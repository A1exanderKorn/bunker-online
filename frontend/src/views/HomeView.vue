<template>
  <div class="p-4 text-center">
    <h1 class="text-2xlmb-4">Добро пожаловать!</h1>
    <div v-if="!nameSet">
      <input type="text" v-model="name" placeholder="Введите имя" class="border p-2" />
      <LobbyForm @click="confirmName" customClass="ml-2 px-4 py-2 bg-blue-500 text-white" text="ОК"/>
    </div>

    <div v-else>
      <LobbyForm @click="createLobby" customClass="px-4 py-2 bg-green-500 text-white mr-4" text="Создать игру"></LobbyForm>
      <LobbyForm @click="joinMode = !joinMode" customClass="px-4 py-2 bg-yellow-400 text-white" text="Присоединиться к игре"></LobbyForm>
      <div v-if="joinMode" class="mt-4">
        <input v-model="code" placeholder="Введите код лобби" class="border p-2" />
        <LobbyForm @click="joinLobby" customClass="ml-2 px-4 py-2 bg-blue-500 text-white" text="Войти"></LobbyForm>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLobbyStore } from '@/stores/lobby'
import { connectSocket } from '@/services/socket'
import LobbyForm from '@/components/LobbyForm.vue'

const store = useLobbyStore()

onMounted(() => {
  store.initFromLocalStorage()
})

const name = ref(store.name??"")
const code = ref('')
const joinMode = ref(false)
const nameSet = ref(store.name === ''?false:true)

const router = useRouter()

const confirmName = () => {
  if (name.value.trim()) {
    store.setLocalStorage(name.value)
    store.setName(name.value)
    nameSet.value = true
  }
}

const createLobby = () => {
  const generatedCode = generateLobbyCode()
  const upperCode = generatedCode.toUpperCase()
  store.setLobby(upperCode, true)
  router.push(`/lobby/${upperCode}`)
}

const joinLobby = () => {
  const upperCode = code.value.toUpperCase()
  store.setLobby(upperCode, false)
  router.push(`/lobby/${upperCode}`)
}

function generateLobbyCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)]
  }
  return code
}
</script>

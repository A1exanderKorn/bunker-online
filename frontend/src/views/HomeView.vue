<template>
  <div class="main-block">
    <h1 class="title-text">Добро пожаловать!</h1>
    <div class="buttons-set" v-if="!nameSet">
      <input class="name-input" type="text" v-model="name" placeholder="Введите имя" />
      <LobbyButton @click="confirmName" customClass="confirm-button" text="ОК"/>
    </div>

    <div class="buttons-set" v-else>
      <LobbyButton @click="createLobby" customClass="base-button" text="Создать игру"/>
      <LobbyButton @click="joinMode = !joinMode" customClass="base-button" text="Присоединиться к игре"/>
  
      <input v-if="joinMode" v-model="code" placeholder="Введите код лобби" class="name-input" />
      <LobbyButton v-if="joinMode" @click="joinLobby" customClass="confirm-button" text="Войти"/>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLobbyStore } from '@/stores/lobby'
import { connectSocket } from '@/services/socket'
import LobbyForm from '@/components/LobbyButton.vue'
import LobbyButton from '@/components/LobbyButton.vue'

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

<style>
  .main-block {
  display: flex;
  flex-direction: column;
  margin: auto;
  height: 100%;
  justify-content: center;
  gap: 30px;
  width: 400px;
  align-items: center;
  font-size: 24px;
}

.buttons-set {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  align-items: center;
}

.name-input {
  border: solid 2px #82eaff;
  border-radius: 6px;
  padding: 6px;
  font-size: 22px;
  width: 100%;
  box-sizing: border-box;
}

.title-text {
  color: coral;
  text-align: center;
  font-size: 28px;
  font-weight: bold;
}
</style>
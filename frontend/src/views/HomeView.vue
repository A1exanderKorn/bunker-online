<template>
  <div class="main-block">
    <h1 class="title-text">Добро пожаловать!</h1>

    <div class="buttons-set" v-if="!nameSet">
      <input class="name-input" type="text" v-model="name" placeholder="Введите имя" />
      <LobbyButton @click="confirmName" customClass="confirm-button" text="ОК" />
    </div>

    <div class="buttons-set" v-else>
      <LobbyButton @click="createLobby" customClass="base-button" text="Создать игру" />
      <LobbyButton
        @click="joinMode = !joinMode"
        customClass="base-button"
        text="Присоединиться к игре"
      />

      <input v-if="joinMode" v-model="code" placeholder="Введите код лобби" class="name-input" />
      <LobbyButton v-if="joinMode" @click="joinLobby" customClass="confirm-button" text="Войти" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import LobbyButton from '@/components/LobbyButton.vue'

const session = useSessionStore()
const router = useRouter()

onMounted(() => session.loadName())

const name = ref(session.name)
const code = ref('')
const joinMode = ref(false)
const nameSet = ref(session.hasName)

function confirmName() {
  if (name.value.trim()) {
    session.setName(name.value.trim())
    nameSet.value = true
  }
}

function createLobby() {
  const generated = generateLobbyCode()
  session.setLobby(generated)
  router.push(`/lobby/${generated}`)
}

function joinLobby() {
  if (!code.value.trim()) return
  session.setLobby(code.value.trim())
  router.push(`/lobby/${session.lobbyCode}`)
}

function generateLobbyCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let result = ''
  for (let i = 0; i < 4; i++) {
    result += letters[Math.floor(Math.random() * letters.length)]
  }
  return result
}
</script>

<style scoped>
.main-block {
  display: flex;
  flex-direction: column;
  margin: auto;
  height: 100vh;
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

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

      <input
        v-if="joinMode"
        v-model="code"
        placeholder="Код лобби (4 буквы)"
        maxlength="4"
        class="name-input"
        @input="code = code.toUpperCase()"
        @keyup.enter="joinLobby"
      />
      <p v-if="joinMode && joinError" class="join-error">{{ joinError }}</p>
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
const joinError = ref('')
const nameSet = ref(session.hasName)

function confirmName() {
  if (name.value.trim()) {
    session.setName(name.value.trim())
    nameSet.value = true
  }
}

function createLobby() {
  const generated = generateLobbyCode()
  session.setLobby(generated, 'create')
  router.push(`/lobby/${generated}`)
}

function joinLobby() {
  const raw = code.value.trim().toUpperCase()
  if (!/^[A-Z]{4}$/.test(raw)) {
    joinError.value = 'Код лобби — ровно 4 латинские буквы'
    return
  }
  joinError.value = ''
  session.setLobby(raw, 'join')
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
  color: var(--text);
}

.buttons-set {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  align-items: center;
}

.name-input {
  border: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 10px;
  font-size: 20px;
  width: 100%;
  box-sizing: border-box;
  background: var(--surface);
  color: var(--text);
}

.title-text {
  color: var(--accent);
  text-align: center;
  font-size: 32px;
  font-weight: 800;
}
.join-error {
  color: var(--danger);
  font-size: 15px;
  margin: 0;
  text-align: center;
}
@media (max-width: 480px) {
  .main-block {
    width: 90%;
    font-size: 20px;
  }
}
</style>

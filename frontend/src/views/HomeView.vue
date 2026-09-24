<template>
  <div class="main-block">
    <h1 class="title-text">Добро пожаловать!</h1>
    <p v-if="profile.loading">Загружаем профиль…</p>
    <div v-else class="profile-entry">
      <template v-if="profile.user">
        <img :src="profile.user.avatarUrl" alt="" width="44" height="44" style="border-radius: 50%" />
        <span>{{ profile.user.nickname }}</span>
      </template>
      <a v-else-if="profile.authEnabled" :href="discordLoginUrl">Войти через Discord</a>
      <RouterLink to="/profile">{{ profile.user ? 'Профиль и история' : 'О профиле' }}</RouterLink>
      <small v-if="!profile.user">Можно играть гостем — без истории игр.</small>
      <p v-if="profile.error" role="alert">{{ profile.error }}</p>
    </div>

    <div class="buttons-set" v-if="!profile.loading && !nameSet">
      <input class="name-input" type="text" v-model="name" placeholder="Введите имя" />
      <LobbyButton @click="confirmName" customClass="confirm-button" text="ОК" />
    </div>

    <div class="buttons-set" v-else-if="!profile.loading">
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
import { useProfileStore, discordLoginUrl } from '@/stores/profile'

const session = useSessionStore()
const router = useRouter()
const profile = useProfileStore()

onMounted(async () => {
  session.loadName()
  await profile.load()
  if (profile.user) session.setName(profile.user.nickname)
  name.value = session.name
  nameSet.value = session.hasName
})

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
  min-height: 100dvh;
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
.profile-entry { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 12px; font-size: 16px; }
.profile-entry a { color: var(--accent); }
.profile-entry small { flex-basis: 100%; text-align: center; }

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

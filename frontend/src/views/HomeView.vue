<template>
  <main class="home-hero" aria-label="Главное меню">
    <div class="main-block">
      <p v-if="profile.loading">Загружаем профиль…</p>
      <div v-else class="profile-entry">
        <template v-if="profile.user">
          <img
            :src="profile.user.avatarUrl"
            alt=""
            width="44"
            height="44"
            style="border-radius: 50%"
          />
          <span>{{ profile.user.nickname }}</span>
        </template>
        <a v-else-if="profile.authEnabled" :href="discordLoginUrl">Войти через Discord</a>
        <RouterLink to="/profile">{{
          profile.user ? 'Профиль и история' : 'Профиль и никнейм'
        }}</RouterLink>
        <p v-if="profile.error" role="alert">{{ profile.error }}</p>
      </div>

      <div class="buttons-set" v-if="!profile.loading && !nameSet">
        <input
          class="name-input"
          type="text"
          v-model="name"
          placeholder="Введите имя"
          aria-label="Ваше имя"
          autocomplete="nickname"
          @keyup.enter="confirmName"
        />
        <LobbyButton @click="confirmName" customClass="confirm-button" text="ОК" />
      </div>

      <div class="buttons-set" v-else-if="!profile.loading">
        <LobbyButton @click="createLobby" customClass="base-button" text="Создать игру" />
        <LobbyButton
          @click="joinMode = !joinMode"
          customClass="btn--secondary btn--block"
          text="Присоединиться к игре"
        />

        <input
          v-if="joinMode"
          v-model="code"
          placeholder="Код лобби (4 буквы)"
          aria-label="Код лобби — четыре латинские буквы"
          maxlength="4"
          class="name-input"
          @input="code = code.toUpperCase()"
          @keyup.enter="joinLobby"
        />
        <p v-if="joinMode && joinError" class="join-error">{{ joinError }}</p>
        <LobbyButton v-if="joinMode" @click="joinLobby" customClass="confirm-button" text="Войти" />
      </div>
    </div>
  </main>
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
.home-hero {
  min-height: calc(100dvh - 120px);
  max-width: 1536px;
  margin: auto;
  padding: 7vh 7vw 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.main-block {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: min(360px, 100%);
  align-items: center;
  color: var(--hero-ink);
}

.buttons-set {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  align-items: center;
}
.profile-entry {
  order: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.profile-entry a {
  color: var(--hero-accent);
  text-underline-offset: 4px;
}
.buttons-set {
  max-width: 360px;
}
.home-hero :deep(.btn) {
  min-height: 50px;
}
.home-hero :deep(.btn--primary) {
  --accent: var(--hero-accent);
  --on-accent: var(--hero-on-accent);
}
.home-hero :deep(.btn--secondary) {
  --btn-bg: color-mix(in srgb, var(--hero-accent) 85%, var(--surface));
  --btn-fg: var(--hero-on-accent);
  border-color: var(--hero-accent);
}

.name-input {
  border: 1px solid var(--hero-border);
  border-radius: var(--radius-sm);
  padding: 10px;
  font-size: 16px;
  width: 100%;
  box-sizing: border-box;
  background: var(--hero-glass);
  color: var(--hero-ink);
}
.name-input::placeholder {
  color: var(--hero-muted);
}

.join-error {
  color: var(--danger);
  font-size: 15px;
  margin: 0;
  text-align: center;
}
@media (max-width: 480px) {
  .home-hero {
    padding: 5vh 24px 20px;
    background: var(--hero-mobile-wash);
  }
  .main-block {
    width: 100%;
  }
}
</style>

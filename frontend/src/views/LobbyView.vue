<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useGameStore } from '@/stores/game'
import { disconnectSocket } from '@/services/socket'
import LobbyButton from '@/components/LobbyButton.vue'
import GameTable from '@/components/GameTable.vue'
import GameStageMessage from '@/components/GameStageMessage.vue'

const route = useRoute()
const session = useSessionStore()
const game = useGameStore()

const { started, stage, timer, isPaused, isHost, isVoting, roster, lastResult, error } =
  storeToRefs(game)

const code = computed(() => (route.params.code as string) ?? session.lobbyCode)
const nameInput = ref(session.name)
const nameEntered = ref(false)
const timerInput = ref('')

function join() {
  const name = nameInput.value.trim()
  if (!name) return
  session.setName(name)
  session.setLobby(code.value)
  game.connect(name, code.value)
  nameEntered.value = true
}

onMounted(() => {
  session.loadName()
  if (session.hasName) {
    nameInput.value = session.name
    join()
  }
})

onUnmounted(() => disconnectSocket())

function parsedTimer(): number | undefined {
  const value = parseInt(timerInput.value, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

// Имя выбывшего для баннера результата голосования.
const eliminatedName = computed(() => {
  const id = lastResult.value?.eliminatedId
  return id ? (roster.value.find((p) => p.id === id)?.name ?? '') : ''
})
</script>

<template>
  <!-- Экран ввода имени -->
  <div v-if="!nameEntered" class="main-block">
    <h1>Лобби: {{ code }}</h1>
    <div class="buttons-set">
      <input class="name-input" v-model="nameInput" placeholder="Введите ваше имя" />
      <LobbyButton @click="join" text="Войти" customClass="confirm-button" />
    </div>
  </div>

  <!-- Игровой экран -->
  <div v-else-if="started" class="game-screen">
    <GameStageMessage :stage="stage" :timer="timer" :isPaused="isPaused" />

    <div v-if="lastResult" class="result-banner">
      <template v-if="lastResult.tie">Ничья — назначено переголосование</template>
      <template v-else-if="eliminatedName">Выбывает: {{ eliminatedName }}</template>
      <template v-else>Никто не выбыл</template>
    </div>

    <GameTable />

    <div v-if="isHost" class="host-controls">
      <div class="timer-controls">
        <input
          v-model="timerInput"
          type="number"
          placeholder="Секунды"
          class="timer-input"
          min="1"
          max="600"
        />
        <LobbyButton @click="game.resetTimer(parsedTimer())" customClass="base-button" text="Сбросить таймер" />
        <LobbyButton
          @click="game.togglePause()"
          :customClass="isPaused ? 'confirm-button' : 'base-button'"
          :text="isPaused ? 'Возобновить' : 'Пауза'"
        />
        <LobbyButton
          @click="game.nextStage(parsedTimer())"
          customClass="base-button"
          text="Следующий этап"
        />
        <LobbyButton
          v-if="isVoting"
          @click="game.resolveVote()"
          customClass="danger-button"
          text="Подвести итог голосования"
        />
      </div>
    </div>
  </div>

  <!-- Экран лобби (до старта) -->
  <div v-else class="main-block">
    <h1>Лобби: {{ code }}</h1>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="buttons-set">
      <h2>Игроки:</h2>
      <ul class="player-list">
        <li v-for="p in roster" :key="p.id" class="player-list-item">{{ p.name }}</li>
      </ul>
      <LobbyButton v-if="isHost" @click="game.startGame()" customClass="confirm-button" text="Начать игру" />
      <p v-else class="hint">Ждём, пока хост начнёт игру…</p>
    </div>
  </div>
</template>

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
  color: #eee;
}
.game-screen {
  padding: 20px;
  max-width: 1100px;
  margin: 0 auto;
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
.player-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  list-style: none;
  padding: 0;
}
.host-controls {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}
.timer-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
.timer-input {
  border: solid 2px #82eaff;
  border-radius: 6px;
  padding: 8px;
  font-size: 16px;
  width: 120px;
  text-align: center;
}
.result-banner {
  background: #2c2c2c;
  color: #ffd479;
  border-radius: 8px;
  padding: 10px 16px;
  text-align: center;
  font-weight: bold;
  margin-bottom: 12px;
}
.error {
  color: #ff6b6b;
  font-size: 18px;
}
.hint {
  font-size: 16px;
  color: #ccc;
}
</style>

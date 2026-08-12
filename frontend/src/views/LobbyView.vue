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
import LobbySettingsPanel from '@/components/LobbySettingsPanel.vue'
import BunkerInfoPanel from '@/components/BunkerInfoPanel.vue'
import ActionCardsPanel from '@/components/ActionCardsPanel.vue'
import CardAdminPanel from '@/components/CardAdminPanel.vue'

const route = useRoute()
const session = useSessionStore()
const game = useGameStore()

const {
  started,
  stage,
  timer,
  isPaused,
  isHost,
  isVoting,
  isEnded,
  isReview,
  isMyTurn,
  isMyVoteTurn,
  roster,
  lastResult,
  survivorIds,
  publicPlayers,
  amSurvivor,
  settings,
  error,
} = storeToRefs(game)

const code = computed(() => (route.params.code as string) ?? session.lobbyCode)
const nameInput = ref(session.name)
const nameEntered = ref(false)

function join() {
  const name = nameInput.value.trim()
  if (!name) return
  session.setName(name)
  session.setLobby(code.value, session.mode)
  game.connect(name, code.value, session.mode)
  nameEntered.value = true
}

const copied = ref(false)
function copyCode() {
  navigator.clipboard?.writeText(code.value).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }).catch(() => {})
}

onMounted(() => {
  session.loadName()
  if (session.hasName) {
    nameInput.value = session.name
    join()
  }
})

onUnmounted(() => disconnectSocket())

// Имя выбывшего для баннера результата голосования.
const eliminatedName = computed(() => {
  const id = lastResult.value?.eliminatedId
  return id ? (roster.value.find((p) => p.id === id)?.name ?? '') : ''
})

// I.3: кнопка активна, только если в этот ход уже что-то вскрыто.
const canEndTurn = computed(() => game.turn.revealedThisTurn >= 1)

const survivorNames = computed(() =>
  survivorIds.value
    .map((id) => publicPlayers.value.find((p) => p.id === id)?.name ?? roster.value.find((p) => p.id === id)?.name)
    .filter(Boolean),
)
</script>

<template>
  <!-- Экран ввода имени -->
  <div v-if="!nameEntered" class="main-block">
    <h1>Лобби: {{ code }}</h1>
    <div class="buttons-set">
      <input
        class="name-input"
        v-model="nameInput"
        placeholder="Введите ваше имя"
        @keyup.enter="join"
      />
      <LobbyButton @click="join" text="Войти" customClass="confirm-button" />
    </div>
  </div>

  <!-- Финальный экран -->
  <div v-else-if="isEnded" class="game-screen">
    <div class="end-screen">
      <h1 :class="amSurvivor ? 'win' : 'lose'">
        {{ amSurvivor ? '🎉 Вы прошли в бункер!' : '☠ Вы не прошли в бункер' }}
      </h1>
      <p class="survivors-title">В бункер прошли:</p>
      <ul class="survivors-list">
        <li v-for="n in survivorNames" :key="n">{{ n }}</li>
      </ul>
      <button v-if="isHost" class="btn btn--primary new-game-btn" @click="game.newGame()">
        🔄 Новая игра
      </button>
      <p v-else class="hint">Ждём, пока хост начнёт новую игру…</p>
    </div>
    <GameTable />
  </div>

  <!-- Игровой экран -->
  <div v-else-if="started" class="game-screen">
    <GameStageMessage :stage="stage" :timer="timer" :isPaused="isPaused" />

    <!-- П.1: стадия ознакомления -->
    <div v-if="isReview" class="review-bar fade-in">
      <span>Ознакомьтесь со своими характеристиками ниже.</span>
      <button v-if="isHost" class="btn btn--success" @click="game.beginRounds()">Начать раунды</button>
      <span v-else class="hint">Ждём хоста…</span>
    </div>

    <BunkerInfoPanel class="info-mb" />

    <ActionCardsPanel class="info-mb" />

    <div v-if="lastResult" class="result-banner">
      <template v-if="lastResult.tie">Ничья — назначено переголосование</template>
      <template v-else-if="eliminatedName">Исключён: {{ eliminatedName }}</template>
      <template v-else>Никто не выбыл</template>
    </div>

    <!-- Кнопка завершения хода для игрока в его ход -->
    <div v-if="isMyTurn" class="my-turn-controls">
      <button
        class="btn btn--success"
        :disabled="!canEndTurn"
        :title="canEndTurn ? '' : 'Сначала вскройте характеристику'"
        @click="game.endTurn()"
      >
        Завершить ход
      </button>
    </div>

    <!-- Поочерёдное голосование: подсказка текущему голосующему -->
    <div v-if="isMyVoteTurn" class="vote-turn-hint fade-in">
      🗳 Ваша очередь — выберите, за кого голосуете (кнопка на карточке игрока)
    </div>

    <GameTable />

    <!-- Мини-админка теста карт (только хост) -->
    <CardAdminPanel v-if="isHost" />

    <!-- Управление хоста -->
    <div v-if="isHost" class="host-controls">
      <LobbyButton
        @click="game.togglePause()"
        :customClass="isPaused ? 'confirm-button' : 'base-button'"
        :text="isPaused ? 'Возобновить' : 'Пауза'"
      />
      <LobbyButton @click="game.resetTimer()" customClass="base-button" text="Сбросить таймер" />
      <LobbyButton
        v-if="isVoting"
        @click="game.resolveVote()"
        customClass="danger-button"
        text="Подвести итог голосования"
      />
    </div>
  </div>

  <!-- Экран лобби (до старта) -->
  <div v-else class="lobby-screen">
    <div class="lobby-head">
      <h1>
        Лобби:
        <button class="code-copy" @click="copyCode" :title="copied ? 'Скопировано!' : 'Нажмите, чтобы скопировать'">
          {{ code }} <span class="copy-ic">{{ copied ? '✓' : '📋' }}</span>
        </button>
      </h1>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="lobby-body">
      <div class="players-col">
        <h2>Игроки ({{ roster.length }})</h2>
        <ul class="player-list">
          <li v-for="(p, i) in roster" :key="p.id" class="player-list-item">
            <span class="pl-name">{{ p.name }}</span>
            <span v-if="i === 0" class="host-tag">хост</span>
            <span v-if="!p.connected" class="off-tag">оффлайн</span>
          </li>
        </ul>
        <LobbyButton
          v-if="isHost"
          @click="game.startGame()"
          customClass="confirm-button start-btn"
          text="Начать игру"
        />
        <p v-else class="hint">Ждём, пока хост начнёт игру…</p>
      </div>

      <div class="settings-col">
        <LobbySettingsPanel />
      </div>
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
  max-width: 90%;
  align-items: center;
  font-size: 24px;
  color: var(--text);
}
.review-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  background: color-mix(in srgb, var(--info) 12%, var(--surface));
  border: 1px solid var(--info);
  border-radius: var(--radius-md);
  padding: 10px 16px;
  margin-bottom: 12px;
  font-weight: 600;
}
.code-copy {
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--accent);
  font-size: inherit;
  font-weight: 800;
  padding: 2px 12px;
  cursor: pointer;
  transition: filter var(--dur-fast);
  letter-spacing: 2px;
}
.code-copy:hover {
  filter: brightness(1.1);
}
.copy-ic {
  font-size: 0.7em;
  letter-spacing: 0;
}
.new-game-btn {
  margin-top: 18px;
  font-size: 17px;
  padding: 12px 28px;
}
.vote-turn-hint {
  text-align: center;
  background: color-mix(in srgb, var(--warn) 14%, var(--surface));
  border: 1px solid var(--warn);
  color: var(--text);
  border-radius: var(--radius-md);
  padding: 8px 14px;
  margin-bottom: 12px;
  font-weight: 600;
}
.game-screen {
  padding: 16px;
  max-width: 1200px;
  margin: 0 auto;
}
.info-mb {
  margin-bottom: 12px;
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

/* Лобби до старта */
.lobby-screen {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 16px;
  color: var(--text);
}
.lobby-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.lobby-head h1 {
  margin: 0;
}
.copy-btn {
  font-size: 14px;
  padding: 6px 12px;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.lobby-body {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
  align-items: start;
  margin-top: 12px;
}
.players-col h2 {
  margin-top: 0;
}
.player-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 16px;
  list-style: none;
  padding: 0;
}
.player-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}
.pl-name {
  font-weight: 600;
}
.host-tag {
  font-size: 11px;
  background: var(--warn);
  color: #3a2b00;
  border-radius: 6px;
  padding: 1px 6px;
}
.off-tag {
  font-size: 11px;
  background: var(--danger);
  color: #fff;
  border-radius: 6px;
  padding: 1px 6px;
}
.start-btn {
  width: 100%;
}
.hint {
  font-size: 16px;
  color: var(--text-muted);
}

/* Игровые контролы */
.host-controls {
  margin-top: 20px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.my-turn-controls {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.result-banner {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--accent);
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  text-align: center;
  font-weight: bold;
  margin-bottom: 12px;
}
.error {
  color: var(--danger);
  font-size: 18px;
}

/* Финальный экран */
.end-screen {
  text-align: center;
  color: var(--text);
  margin-bottom: 20px;
}
.end-screen h1.win {
  color: var(--success);
}
.end-screen h1.lose {
  color: var(--danger);
}
.survivors-title {
  font-size: 18px;
  color: var(--accent);
}
.survivors-list {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.survivors-list li {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 14px;
  font-weight: 600;
}

@media (max-width: 760px) {
  .lobby-body {
    grid-template-columns: 1fr;
  }
}
</style>

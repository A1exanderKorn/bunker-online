<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { CHARACTERISTIC_CATEGORIES, type ActionCard, type CardTargets } from '@shared/types'

/**
 * Модалка активации карты: пошагово собирает цели по pickSpecs,
 * затем формирует CardTargets и подтверждает.
 */
const props = defineProps<{ card: ActionCard }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm', targets: CardTargets): void }>()

const game = useGameStore()
const { publicPlayers, myId, bunker } = storeToRefs(game)

const stepIdx = ref(0)
const chosenPlayers = ref<string[]>([])
const chosenChars = ref<{ playerId: string; category: string }[]>([])
const chosenCategories = ref<string[]>([])
const chosenThreats = ref<number[]>([])

const specs = computed(() => props.card.pickSpecs)
const current = computed(() => specs.value[stepIdx.value])
const isLast = computed(() => stepIdx.value >= specs.value.length - 1)

// Кандидаты-игроки: живые (для большинства карт можно и себя).
const alivePlayers = computed(() => publicPlayers.value.filter((p) => p.isAlive))

// Для выбора характеристики — категории конкретного игрока (последний выбранный или сам).
const charTargetPlayer = computed(() => {
  // Если карта уже выбрала игрока — берём его, иначе себя.
  return chosenPlayers.value[chosenPlayers.value.length - 1] ?? myId.value
})
const availableCategories = computed<string[]>(() => [...CHARACTERISTIC_CATEGORIES, 'Биология'])

function pickPlayer(id: string) {
  chosenPlayers.value.push(id)
  next()
}
function pickCharacteristic(category: string) {
  chosenChars.value.push({ playerId: charTargetPlayer.value, category })
  next()
}
function pickCategory(category: string) {
  chosenCategories.value.push(category)
  next()
}
function pickThreat(idx: number) {
  chosenThreats.value.push(idx)
  next()
}

function next() {
  if (isLast.value) confirm()
  else stepIdx.value += 1
}

function confirm() {
  const targets: CardTargets = {}
  if (chosenPlayers.value.length) targets.players = chosenPlayers.value
  if (chosenChars.value.length) targets.characteristics = chosenChars.value
  if (chosenCategories.value.length) targets.categories = chosenCategories.value
  if (chosenThreats.value.length) targets.threats = chosenThreats.value
  emit('confirm', targets)
}

function playerName(id: string) {
  return publicPlayers.value.find((p) => p.id === id)?.name ?? '?'
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal card fade-in">
      <header class="modal-head">
        <h3>{{ card.title }}</h3>
        <button class="x-btn" @click="emit('close')">✕</button>
      </header>

      <p v-if="card.note" class="modal-note">{{ card.note }}</p>

      <div class="step">
        <p class="step-label">{{ current?.label }}</p>

        <!-- Выбор игрока -->
        <div v-if="current?.kind === 'player'" class="options">
          <button v-for="p in alivePlayers" :key="p.id" class="opt" @click="pickPlayer(p.id)">
            {{ p.name }}<span v-if="p.id === myId"> (вы)</span>
          </button>
        </div>

        <!-- Выбор характеристики (категории) у целевого игрока -->
        <div v-else-if="current?.kind === 'characteristic'" class="options">
          <div class="target-hint">Игрок: <b>{{ playerName(charTargetPlayer) }}</b></div>
          <button v-for="cat in availableCategories" :key="cat" class="opt" @click="pickCharacteristic(cat)">
            {{ cat }}
          </button>
        </div>

        <!-- Выбор категории (для «пересдать всем») -->
        <div v-else-if="current?.kind === 'catCategory'" class="options">
          <button v-for="cat in availableCategories" :key="cat" class="opt" @click="pickCategory(cat)">
            {{ cat }}
          </button>
        </div>

        <!-- Выбор угрозы -->
        <div v-else-if="current?.kind === 'threat'" class="options">
          <button
            v-for="(t, i) in bunker.threats"
            :key="i"
            class="opt threat-opt"
            @click="pickThreat(i)"
          >
            {{ t.slice(0, 60) }}…
          </button>
          <p v-if="bunker.threats.length === 0" class="empty">Нет угроз для удаления.</p>
        </div>
      </div>

      <div class="progress">Шаг {{ stepIdx + 1 }} из {{ specs.length }}</div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 16px;
}
.modal {
  width: 100%;
  max-width: 440px;
  padding: 18px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}
.modal-head h3 {
  margin: 0;
  font-size: 17px;
  color: var(--accent);
}
.x-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
}
.modal-note {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 12px;
}
.step-label {
  font-weight: 600;
  margin: 0 0 10px;
}
.options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.opt {
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  font-size: 14px;
  cursor: pointer;
  transition: background var(--dur-fast), transform var(--dur-fast);
}
.opt:hover {
  background: var(--accent);
  color: #fff;
  transform: translateY(-1px);
}
.threat-opt {
  flex: 1 1 100%;
  text-align: left;
}
.target-hint {
  flex: 1 1 100%;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.empty {
  color: var(--text-faint);
  font-size: 13px;
}
.progress {
  margin-top: 14px;
  font-size: 12px;
  color: var(--text-faint);
  text-align: right;
}
</style>

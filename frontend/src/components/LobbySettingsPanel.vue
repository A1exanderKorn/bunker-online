<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import {
  SETTINGS_LIMITS,
  VOTE_MODE_LABELS,
  CARDS_POWER_LABELS,
  characteristicsCount,
  cumulativeReveals,
  remainingPlayers,
  type LobbySettings,
  type RoundStep,
  type VoteMode,
  type CardsPower,
} from '@shared/types'

/**
 * Панель настроек лобби. Для хоста — редактируемая, для остальных — readonly.
 * Все изменения уходят на сервер, который валидирует и рассылает всем.
 */
const game = useGameStore()
const { settings, isHost, roster } = storeToRefs(game)
const L = SETTINGS_LIMITS

const playerCount = computed(() => roster.value.length)
const charCount = computed(() => characteristicsCount(settings.value))
const cumReveals = computed(() => cumulativeReveals(settings.value.roundSteps))
const remaining = computed(() => remainingPlayers(settings.value.roundSteps, playerCount.value))

function patch(partial: Partial<LobbySettings>) {
  game.updateSettings(partial)
}
function updateNum<K extends keyof LobbySettings>(key: K, raw: string) {
  const num = key === 'targetCoef' ? parseFloat(raw) : parseInt(raw, 10)
  if (!Number.isFinite(num)) return
  patch({ [key]: num } as Partial<LobbySettings>)
}

// ── Редактор шагов раундов ──
function setSteps(steps: RoundStep[]) {
  patch({ roundSteps: steps })
}
function toggleKind(i: number) {
  if (!isHost.value) return
  const steps = settings.value.roundSteps.map((s, idx) =>
    idx === i
      ? s.kind === 'reveal'
        ? ({ kind: 'vote', revealThreat: false } as RoundStep)
        : ({ kind: 'reveal', revealThreat: false } as RoundStep)
      : { ...s },
  )
  setSteps(steps)
}
function toggleThreat(i: number) {
  if (!isHost.value) return
  const steps = settings.value.roundSteps.map((s, idx) =>
    idx === i ? { ...s, revealThreat: !s.revealThreat } : { ...s },
  )
  setSteps(steps)
}
function addStep(kind: 'reveal' | 'vote') {
  const step: RoundStep =
    kind === 'reveal'
      ? { kind: 'reveal', revealThreat: false }
      : { kind: 'vote', revealThreat: false }
  setSteps([...settings.value.roundSteps, step])
}
function removeStep(i: number) {
  setSteps(settings.value.roundSteps.filter((_, idx) => idx !== i))
}

const survivorsHint = computed(() =>
  settings.value.survivorsCount === 0 ? '(авто: половина)' : '',
)
</script>

<template>
  <section class="card settings-panel fade-in">
    <header class="settings-head">
      <h3>Настройки игры</h3>
      <span class="mode-badge">{{ isHost ? 'редактирование' : 'только чтение' }}</span>
    </header>

    <div class="settings-grid">
      <label class="field">
        <span class="field-label">Время хода, сек</span>
        <input class="input" type="number" :value="settings.turnSeconds" :min="L.turnSeconds.min" :max="L.turnSeconds.max" :disabled="!isHost" @change="updateNum('turnSeconds', ($event.target as HTMLInputElement).value)" />
      </label>
      <label v-if="settings.voteMode === 'simultaneous'" class="field">
        <span class="field-label">Время голосования, сек</span>
        <input class="input" type="number" :value="settings.voteSeconds" :min="L.voteSeconds.min" :max="L.voteSeconds.max" :disabled="!isHost" @change="updateNum('voteSeconds', ($event.target as HTMLInputElement).value)" />
      </label>
      <label v-else class="field">
        <span class="field-label">Время на игрока, сек</span>
        <input class="input" type="number" :value="settings.sequentialVoteSeconds" :min="L.sequentialVoteSeconds.min" :max="L.sequentialVoteSeconds.max" :disabled="!isHost" @change="updateNum('sequentialVoteSeconds', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="field">
        <span class="field-label">Целевой коэффициент</span>
        <input class="input" type="number" step="0.05" :value="settings.targetCoef" :min="L.targetCoef.min" :max="L.targetCoef.max" :disabled="!isHost" @change="updateNum('targetCoef', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="field">
        <span class="field-label">Останется игроков {{ survivorsHint }}</span>
        <input class="input" type="number" :value="settings.survivorsCount" :min="L.survivorsCount.min" :max="L.survivorsCount.max" :disabled="!isHost" @change="updateNum('survivorsCount', ($event.target as HTMLInputElement).value)" />
      </label>
    </div>

    <!-- Переключатели режимов -->
    <div class="switches">
      <div class="switch-group">
        <span class="switch-title">Голосование</span>
        <div class="seg">
          <button
            v-for="mode in (['simultaneous', 'sequential'] as VoteMode[])"
            :key="mode"
            class="seg-btn"
            :class="{ active: settings.voteMode === mode }"
            :disabled="!isHost"
            @click="patch({ voteMode: mode })"
          >
            {{ VOTE_MODE_LABELS[mode] }}
          </button>
        </div>
      </div>

      <label class="check" :class="{ ro: !isHost }">
        <input type="checkbox" :checked="settings.extraBaggage" :disabled="!isHost" @change="patch({ extraBaggage: ($event.target as HTMLInputElement).checked })" />
        <span>Доп. багаж <em class="mini">(8-я хар-ка)</em></span>
      </label>
      <label class="check" :class="{ ro: !isHost }">
        <input type="checkbox" :checked="settings.noPhobias" :disabled="!isHost" @change="patch({ noPhobias: ($event.target as HTMLInputElement).checked })" />
        <span>Без фобий</span>
      </label>
      <label class="check" :class="{ ro: !isHost }">
        <input type="checkbox" :checked="settings.threatsEnabled" :disabled="!isHost" @change="patch({ threatsEnabled: ($event.target as HTMLInputElement).checked })" />
        <span>Угрозы</span>
      </label>
      <label class="check" :class="{ ro: !isHost }">
        <input type="checkbox" :checked="settings.actionCardsEnabled" :disabled="!isHost" @change="patch({ actionCardsEnabled: ($event.target as HTMLInputElement).checked })" />
        <span>Карты действия</span>
      </label>
    </div>

    <!-- Влияние карт (только если карты включены) -->
    <div v-if="settings.actionCardsEnabled" class="switches">
      <div class="switch-group">
        <span class="switch-title">Влияние карт</span>
        <div class="seg">
          <button
            v-for="pw in (['weak', 'balanced', 'strong'] as CardsPower[])"
            :key="pw"
            class="seg-btn"
            :class="{ active: settings.cardsPower === pw }"
            :disabled="!isHost"
            @click="patch({ cardsPower: pw })"
          >
            {{ CARDS_POWER_LABELS[pw] }}
          </button>
        </div>
      </div>
    </div>

    <div class="char-count">Число характеристик: <b>{{ charCount }}</b></div>

    <!-- Таблица шагов раундов -->
    <div class="rounds-wrap">
      <div class="rounds-title">Программа раундов</div>
      <div class="rounds-scroll">
        <table class="rounds-table">
          <tbody>
            <tr class="r-head">
              <th class="r-label">№</th>
              <th v-for="(_, i) in settings.roundSteps" :key="'n' + i" class="r-num">{{ i + 1 }}</th>
              <th v-if="isHost" class="r-add"></th>
            </tr>
            <tr>
              <th class="r-label">Раунд</th>
              <td v-for="(step, i) in settings.roundSteps" :key="'k' + i" class="r-cell">
                <button class="kind-btn" :class="step.kind" :disabled="!isHost" @click="toggleKind(i)" :title="step.kind === 'reveal' ? 'Вскрытие (клик — сменить на голосование)' : 'Голосование (клик — сменить на вскрытие)'">
                  <span v-if="step.kind === 'reveal'">🌍</span>
                  <span v-else>💀</span>
                  <span v-if="step.kind === 'reveal' && step.revealThreat" class="threat-corner">⚠</span>
                </button>
              </td>
              <td v-if="isHost" class="r-add">
                <button class="add-btn" @click="addStep('reveal')" title="Добавить шаг вскрытия">＋🌍</button>
                <button class="add-btn" @click="addStep('vote')" title="Добавить голосование">＋💀</button>
              </td>
            </tr>
            <tr>
              <th class="r-label">Вскрыто (всего)</th>
              <td v-for="(_, i) in settings.roundSteps" :key="'c' + i" class="r-cell readonly-cell">{{ cumReveals[i] }}</td>
              <td v-if="isHost"></td>
            </tr>
            <tr>
              <th class="r-label">Останется игроков</th>
              <td v-for="(_, i) in settings.roundSteps" :key="'r' + i" class="r-cell readonly-cell">{{ remaining[i] }}</td>
              <td v-if="isHost"></td>
            </tr>
            <tr>
              <th class="r-label">Угроза</th>
              <td v-for="(step, i) in settings.roundSteps" :key="'t' + i" class="r-cell">
                <input
                  v-if="step.kind === 'reveal'"
                  type="checkbox"
                  :checked="step.revealThreat"
                  :disabled="!isHost || !settings.threatsEnabled"
                  @change="toggleThreat(i)"
                />
                <span v-else class="dash">—</span>
              </td>
              <td v-if="isHost"></td>
            </tr>
            <tr v-if="isHost">
              <th class="r-label">Удалить</th>
              <td v-for="(_, i) in settings.roundSteps" :key="'d' + i" class="r-cell">
                <button class="del-btn" @click="removeStep(i)" title="Удалить шаг">✕</button>
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  </section>
</template>

<style scoped>
.settings-panel {
  padding: 16px;
  color: var(--text);
  width: 100%;
}
.settings-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 8px;
}
.settings-head h3 {
  margin: 0;
  font-size: 18px;
  color: var(--accent);
}
.mode-badge {
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-3);
  border-radius: 6px;
  padding: 2px 8px;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.field-label {
  color: var(--text-muted);
}

.switches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin: 16px 0 8px;
}
.switch-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.switch-title {
  font-size: 12px;
  color: var(--text-muted);
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.seg-btn {
  border: none;
  background: var(--surface-2);
  color: var(--text);
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--dur-fast);
}
.seg-btn.active {
  background: var(--accent);
  color: #fff;
}
.seg-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.check.ro {
  cursor: default;
}
.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
.mini {
  color: var(--text-faint);
  font-style: normal;
  font-size: 11px;
}
.char-count {
  font-size: 14px;
  margin: 6px 0 12px;
}
.char-count b {
  color: var(--accent);
}

.rounds-wrap {
  margin-top: 8px;
}
.rounds-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
  color: var(--text);
}
.rounds-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.rounds-table {
  border-collapse: collapse;
  font-size: 13px;
  min-width: 100%;
}
.rounds-table th,
.rounds-table td {
  border: 1px solid var(--border);
  padding: 5px 8px;
  text-align: center;
  white-space: nowrap;
}
.r-label {
  text-align: left;
  color: var(--text-muted);
  background: var(--surface-2);
  position: sticky;
  left: 0;
  z-index: 1;
  font-weight: 600;
}
.r-num {
  color: var(--text-faint);
}
.readonly-cell {
  color: var(--text-muted);
  background: var(--surface-2);
}
.kind-btn {
  position: relative;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}
.kind-btn:disabled {
  cursor: default;
}
.kind-btn.vote {
  background: color-mix(in srgb, var(--danger) 12%, var(--surface));
}
.threat-corner {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 11px;
  color: var(--warn);
}
.reveal-input {
  width: 46px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  border-radius: 6px;
  padding: 4px;
  text-align: center;
  font-size: 13px;
}
.dash {
  color: var(--text-faint);
}
.add-btn,
.del-btn {
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 12px;
  cursor: pointer;
  margin: 1px;
}
.del-btn {
  color: var(--danger);
}
.r-add {
  background: var(--surface-2);
}
.rounds-note {
  font-size: 12px;
  color: var(--text-faint);
  margin: 8px 0 0;
}
</style>

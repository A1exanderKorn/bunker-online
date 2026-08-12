<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGameStore } from '@/stores/game'
import { SETTINGS_LIMITS, type LobbySettings } from '@shared/types'

/**
 * Панель настроек лобби. Для хоста — редактируемая, для остальных — readonly.
 * Все изменения уходят на сервер, который валидирует и рассылает всем.
 */
const game = useGameStore()
const { settings, isHost } = storeToRefs(game)

const L = SETTINGS_LIMITS

function update<K extends keyof LobbySettings>(key: K, raw: string) {
  const num = key === 'targetCoef' ? parseFloat(raw) : parseInt(raw, 10)
  if (!Number.isFinite(num)) return
  game.updateSettings({ [key]: num } as Partial<LobbySettings>)
}

const survivorsHint = computed(() =>
  settings.value.survivorsCount === 0 ? '(авто: половина игроков)' : '',
)
</script>

<template>
  <section class="settings-panel">
    <header class="settings-head">
      <h3>Настройки игры</h3>
      <span class="mode-badge">{{ isHost ? 'редактирование' : 'только чтение' }}</span>
    </header>

    <div class="settings-grid">
      <label class="field">
        <span class="field-label">Время хода, сек</span>
        <input
          type="number"
          :value="settings.turnSeconds"
          :min="L.turnSeconds.min"
          :max="L.turnSeconds.max"
          :disabled="!isHost"
          @change="update('turnSeconds', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label class="field">
        <span class="field-label">Время голосования, сек</span>
        <input
          type="number"
          :value="settings.voteSeconds"
          :min="L.voteSeconds.min"
          :max="L.voteSeconds.max"
          :disabled="!isHost"
          @change="update('voteSeconds', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label class="field">
        <span class="field-label">
          Целевой коэффициент
          <em class="tip" title="Средний коэффициент набора характеристик. Выше — «сильнее» игроки.">ⓘ</em>
        </span>
        <input
          type="number"
          step="0.05"
          :value="settings.targetCoef"
          :min="L.targetCoef.min"
          :max="L.targetCoef.max"
          :disabled="!isHost"
          @change="update('targetCoef', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label class="field">
        <span class="field-label">Вскрытий до 1-го голосования</span>
        <input
          type="number"
          :value="settings.revealsBeforeFirstVote"
          :min="L.revealsBeforeFirstVote.min"
          :max="L.revealsBeforeFirstVote.max"
          :disabled="!isHost"
          @change="update('revealsBeforeFirstVote', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label class="field">
        <span class="field-label">Вскрытий за раунд (далее)</span>
        <input
          type="number"
          :value="settings.revealsPerRound"
          :min="L.revealsPerRound.min"
          :max="L.revealsPerRound.max"
          :disabled="!isHost"
          @change="update('revealsPerRound', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label class="field">
        <span class="field-label">Останется игроков {{ survivorsHint }}</span>
        <input
          type="number"
          :value="settings.survivorsCount"
          :min="L.survivorsCount.min"
          :max="L.survivorsCount.max"
          :disabled="!isHost"
          @change="update('survivorsCount', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
  </section>
</template>

<style scoped>
.settings-panel {
  background: #2b2b33;
  border: 1px solid #3d3d47;
  border-radius: 12px;
  padding: 16px;
  color: #eee;
  width: 100%;
  box-sizing: border-box;
}
.settings-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}
.settings-head h3 {
  margin: 0;
  font-size: 18px;
  color: #ffd479;
}
.mode-badge {
  font-size: 12px;
  color: #9aa;
  background: #1f1f26;
  border-radius: 6px;
  padding: 2px 8px;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.field-label {
  color: #bcbcc7;
}
.field input {
  border: 1px solid #4a4a57;
  background: #1c1c22;
  color: #fff;
  border-radius: 6px;
  padding: 8px;
  font-size: 15px;
  width: 100%;
  box-sizing: border-box;
}
.field input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.tip {
  cursor: help;
  color: #82eaff;
  font-style: normal;
}
</style>

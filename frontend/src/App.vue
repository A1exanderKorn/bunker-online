<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import CardPlayedPopup from '@/components/CardPlayedPopup.vue'
import ThreatPopup from '@/components/ThreatPopup.vue'
import { useGameStore } from '@/stores/game'
import { useThemeStore } from '@/stores/theme'

const route = useRoute()
const game = useGameStore()
const theme = useThemeStore()
const scene = computed(() =>
  route.path === '/'
    ? 'scene--home'
    : route.path.startsWith('/lobby/') && game.started
      ? 'scene--game'
      : 'scene--inner',
)
</script>

<template>
  <div class="app-shell" :class="scene">
    <header class="site-header">
      <RouterLink to="/" class="brand" aria-label="Бункер — главная">
        <span class="brand-mark" aria-hidden="true">Б</span>
        <span class="brand-name">Бункер онлайн</span>
      </RouterLink>
      <nav class="app-toolbar" aria-label="Настройки и профиль">
        <div class="theme-selector" role="group" aria-label="Цветовая тема">
          <button
            type="button"
            class="theme-option"
            :aria-pressed="theme.mode === 'dark'"
            @click="theme.set('dark')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a8.5 8.5 0 1 0 9.7 9.7Z" />
            </svg>
            <span>Тёмная</span>
          </button>
          <button
            type="button"
            class="theme-option"
            :aria-pressed="theme.mode === 'light'"
            @click="theme.set('light')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <span>Светлая</span>
          </button>
        </div>
        <RouterLink
          v-if="route.path.startsWith('/lobby/')"
          :to="{ name: 'Profile', query: { returnTo: route.path } }"
          class="toolbar-button btn btn--ghost btn--sm"
          title="Профиль и никнейм"
          aria-label="Профиль и никнейм"
        >
          <svg class="profile-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
          </svg>
        </RouterLink>
      </nav>
    </header>
    <RouterView />
    <ThreatPopup />
    <CardPlayedPopup />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  position: relative;
}
.app-toolbar {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.site-header {
  flex-wrap: wrap;
}
.toolbar-button {
  min-width: 44px;
  min-height: 44px;
  text-decoration: none;
  background: var(--surface);
}
.theme-selector {
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.theme-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: 600 13px var(--font);
  cursor: pointer;
}
.theme-option:hover {
  color: var(--text);
  background: var(--surface-3);
}
.theme-option[aria-pressed='true'] {
  color: var(--accent);
  background: var(--surface);
  border-color: var(--border-strong);
}
.theme-option:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.theme-option svg,
.profile-icon {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>

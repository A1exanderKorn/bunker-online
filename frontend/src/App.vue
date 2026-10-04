<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import CardPlayedPopup from '@/components/CardPlayedPopup.vue'
import ThreatPopup from '@/components/ThreatPopup.vue'
import { useGameStore } from '@/stores/game'

const route = useRoute()
const game = useGameStore()
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
      <nav class="app-toolbar" aria-label="Профиль">
        <RouterLink
          v-if="route.path.startsWith('/lobby/')"
          :to="{ name: 'Profile', query: { returnTo: route.path } }"
          class="toolbar-button btn btn--ghost btn--sm"
          title="Профиль и никнейм"
          aria-label="Профиль и никнейм"
        >
          <span aria-hidden="true">👤</span>
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
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-button {
  min-width: 36px;
  min-height: 36px;
  text-decoration: none;
  backdrop-filter: blur(6px);
  background: color-mix(in srgb, var(--surface) 80%, transparent);
}
</style>

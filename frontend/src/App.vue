<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import CardPlayedPopup from '@/components/CardPlayedPopup.vue'
import ThreatPopup from '@/components/ThreatPopup.vue'

const theme = useThemeStore()
const route = useRoute()
const icon = computed(() =>
  theme.mode === 'system' ? '🖥' : theme.effective === 'dark' ? '🌙' : '☀️',
)
const label = computed(() =>
  theme.mode === 'system' ? 'Системная' : theme.mode === 'dark' ? 'Тёмная' : 'Светлая',
)
</script>

<template>
  <div class="app-shell">
    <nav class="app-toolbar" aria-label="Профиль и оформление">
      <RouterLink v-if="route.path.startsWith('/lobby/')" :to="{ name: 'Profile', query: { returnTo: route.path } }" class="toolbar-button btn btn--ghost btn--sm" title="Профиль и никнейм" aria-label="Профиль и никнейм">
        <span aria-hidden="true">👤</span>
      </RouterLink>
      <button class="toolbar-button btn btn--ghost btn--sm" @click="theme.cycle()" :title="'Тема: ' + label" :aria-label="'Тема: ' + label">
        <span class="theme-icon">{{ icon }}</span>
        <span class="theme-label">{{ label }}</span>
      </button>
    </nav>
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
.theme-icon {
  font-size: 15px;
}
@media (max-width: 480px) {
  .theme-label {
    display: none;
  }
}
</style>

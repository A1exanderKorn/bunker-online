<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import { useThemeStore } from '@/stores/theme'
import CardPlayedPopup from '@/components/CardPlayedPopup.vue'

const theme = useThemeStore()
const icon = computed(() =>
  theme.mode === 'system' ? '🖥' : theme.effective === 'dark' ? '🌙' : '☀️',
)
const label = computed(() =>
  theme.mode === 'system' ? 'Системная' : theme.mode === 'dark' ? 'Тёмная' : 'Светлая',
)
</script>

<template>
  <div class="app-shell">
    <button class="theme-toggle btn btn--ghost btn--sm" @click="theme.cycle()" :title="'Тема: ' + label">
      <span class="theme-icon">{{ icon }}</span>
      <span class="theme-label">{{ label }}</span>
    </button>
    <RouterView />
    <CardPlayedPopup />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  position: relative;
}
.theme-toggle {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 100;
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

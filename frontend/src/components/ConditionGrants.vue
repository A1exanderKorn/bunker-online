<script setup lang="ts">
import { computed } from 'vue'
import { grantsView } from '@shared/bunkerDisplay'

const props = defineProps<{ grants: string[] }>()
const view = computed(() => grantsView(props.grants))
</script>

<template>
  <div class="grants-block">
    <p v-if="view.kind === 'empty'" class="grants-faint">{{ view.heading }}</p>
    <template v-else>
      <p class="grants-heading">{{ view.heading }}</p>
      <ul class="grants-list">
        <li v-for="label in view.labels" :key="label">{{ label }}</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.grants-block {
  margin-top: 8px;
}
.grants-heading {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-muted);
}
.grants-faint {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint);
}
.grants-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
}
</style>

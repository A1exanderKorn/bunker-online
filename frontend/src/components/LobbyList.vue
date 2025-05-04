<template>
  <div class="text-left">
    <h3 class="text-lg font-semibold mb-2">Игроки в лобби:</h3>
    <ul class="space-y-1">
      <li v-for="(player, index) in players" :key="index" class="border rounded p-2 bg-gray-100">
        {{ player }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  players: string[]
}>()
</script>

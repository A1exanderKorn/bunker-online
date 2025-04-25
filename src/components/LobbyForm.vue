<template>
  <div class="space-y-4">
    <div>
      <label>Имя:</label>
      <input v-model="name" class="border p-2 w-full" placeholder="Введите имя игрока" />
    </div>

    <div v-if="showLobbyCodeInput">
      <label>Код лобби:</label>
      <input v-model="lobbyCode" class="border p-2 w-full" placeholder="Например: AB12" />
    </div>

    <div class="flex justify-end gap-4">
      <button
        v-if="!showLobbyCodeInput"
        @click="$emit('create', name)"
        class="bg-green-500 text-white px-4 py-2 rounded"
      >
        Создать игру
      </button>

      <button
        v-if="!showLobbyCodeInput"
        @click="showLobbyCodeInput = true"
        class="bg-yellow-400 text-white px-4 py-2 rounded"
      >
        Присоединиться
      </button>

      <button
        v-if="showLobbyCodeInput"
        @click="$emit('join', name, lobbyCode)"
        class="bg-blue-500 text-white px-4 py-2 rounded"
      >
        Войти
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const name = ref('')
const lobbyCode = ref('')
const showLobbyCodeInput = ref(false)

defineEmits<{
  (e: 'create', name: string): void
  (e: 'join', name: string, code: string): void
}>()
</script>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import HomeView from './components/LobbyButton.vue'

</script>

<template>
  <RouterView />
</template>

<script setup lang="ts"></script>

<style>
body {
  font-family: sans-serif;
  background-color: #545454;
  margin: 0;
  padding: 0;
}

button {
  cursor: pointer;
  font-weight: bold;
  font-size: 20px;
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  transition: background-color 0.2s, transform 0.1s;
}

button:hover {
  transform: scale(1.03);
}

.base-button {
  background-color: #f0c987;
  color: #333;
}

.confirm-button {
  background-color: #2ecc71;
  color: white;
}

.danger-button {
  background-color: #e74c3c;
  color: white;
}
</style>

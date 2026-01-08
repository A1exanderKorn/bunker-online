<template>
  <div class="game-stage-panel">
    <h1>Пандемия</h1>
    <p>
      Смертельный вирус, созданный как биологическое оружие, выходит из-под контроля и провоцирует
      глобальную эпидемию. После выхода из бункера вас встретят уже менее заразные, но мутировавшие
      виды животных и людей. Вам придется избегать контактов с зараженными, поддерживать иммунитет,
      найти источник заразы и разработать вакцину от вируса.
    </p>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.game-stage-panel {
  background-color: rgba(0, 0, 0, 0.6); /* полупрозрачный черный фон */
  color: white;
  padding: 1.5rem;
  border-radius: 12px;
  max-width: 700px;
  margin: 2rem auto;
  font-family: sans-serif;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
}

.game-stage-panel h1 {
  margin-bottom: 1rem;
  font-size: 1.8rem;
}

.game-stage-panel p {
  line-height: 1.5;
  font-size: 1.1rem;
}
</style>

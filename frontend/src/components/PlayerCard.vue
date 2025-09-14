<script setup lang="ts">
import type { Characteristic } from '@/stores/player';
import { computed } from 'vue'

const props = defineProps<{
  player: {
    id: string
    nickname: string
    characteristics: Characteristic[]
    biology: {
      sex: string
      age: number
      experience: number
      coef: number
      infertile: boolean
      isVisible: boolean
    }
  }
  selfId: string
}>()

const isSelf = computed(() => props.player.id === props.selfId)

const visibleCharacteristics = computed(() => {
  return isSelf.value
    ? props.player.characteristics
    : props.player.characteristics.filter((c) => c.isVisible)
})

const visibleBiology = computed(() => {
  return isSelf.value || props.player.biology.isVisible ? props.player.biology : null
})
</script>

<template>
  <div class="card">
    <h2 class="nickname">{{ player.nickname }}</h2>

    <ul class="details">
      <li v-if="visibleBiology">
        Биология: {{ visibleBiology.sex }}, {{ visibleBiology.age }} лет, опыт:
        {{ visibleBiology.experience }} лет, бесплоден:
        {{ visibleBiology.infertile ? 'да' : 'нет' }},
      </li>
      <li v-for="(char, index) in visibleCharacteristics" :key="index">
        {{ char.type }}: {{ char.value }}
      </li>
    </ul>

    <p class="footer">
      {{ isSelf ? 'Вы' : 'Игрок' }}
    </p>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 20px;
  background-color: grey;
  padding: 20px;
  min-height: 100vh;
}

.card {
  background-color: #fff;
  color: #000;
  width: 300px;
  min-width: 300px;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.nickname {
  font-size: 1.5em;
  margin-bottom: 10px;
}

.details {
  list-style: none;
  padding: 0;
  margin: 0 0 10px 0;
}

.details li {
  margin-bottom: 5px;
}

.footer {
  font-size: 0.9em;
  color: #555;
  text-align: right;
}
</style>
